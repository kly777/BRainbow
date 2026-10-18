// ── /task 底部常驻命令栏 ──
//
// 解析在 lib/todo-txt.ts（纯函数，有测试）。这里只负责输入/历史/输出，
// 执行一律走 TaskProvider 已有的 add / updateStatus / updateTaskE / deleteTaskE。
// 命令栏常驻页面底部，回车后在上方展开输出，不挡列表操作。

import { ChevronDown, ChevronUp, Terminal } from "@components/ui/icons";
import { showConfirm } from "@components/ui";
import { isImeComposing } from "@shared/utils";
import {
	createEffect,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { deleteTaskE } from "../api.ts";
import type { Task } from "../api.ts";
import { useTasks } from "../components/TaskProvider.tsx";
import {
	COMMAND_DETAILS,
	COMMAND_HELP,
	formatTodoTask,
	parseTodoCommand,
	type TodoCommand,
} from "../lib/todo-txt.ts";
import styles from "./TaskCommandBar.module.css";

interface Line {
	kind: "input" | "output" | "error" | "muted";
	text: string;
}

export interface TaskCommandBarProps {
	onSearch: (query: string) => void;
}

const COMPLETION = [
	"add",
	"addm",
	"append",
	"prepend",
	"replace",
	"list",
	"listall",
	"listpri",
	"listproj",
	"listcon",
	"do",
	"undo",
	"del",
	"pri",
	"depri",
	"due",
	"tag",
	"untag",
	"search",
	"archive",
	"report",
	"help",
	"clear",
];

export default function TaskCommandBar(props: TaskCommandBarProps) {
	const { tasks, stats, add, updateStatus, updateTaskE, reload, reloadStats } =
		useTasks();
	const [lines, setLines] = createSignal<Line[]>([]);
	const [value, setValue] = createSignal("");
	const [history, setHistory] = createSignal<string[]>([]);
	const [historyIndex, setHistoryIndex] = createSignal(-1);
	const [busy, setBusy] = createSignal(false);
	const [expanded, setExpanded] = createSignal(false);
	let inputRef: HTMLInputElement | undefined;
	let logRef: HTMLDivElement | undefined;

	const push = (kind: Line["kind"], text: string) => {
		setLines((prev) => [...prev, { kind, text }].slice(-200));
		setExpanded(true);
	};

	createEffect(() => {
		lines();
		if (!expanded()) return;
		queueMicrotask(() => {
			if (logRef) logRef.scrollTop = logRef.scrollHeight;
		});
	});

	onMount(() => {
		const handleKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const editing = target?.closest(
				"input, textarea, select, [contenteditable='true']",
			);
			if (editing) return;
			if (event.key === ":") {
				event.preventDefault();
				inputRef?.focus();
			}
		};
		window.addEventListener("keydown", handleKey);
		onCleanup(() => window.removeEventListener("keydown", handleKey));
	});

	const findTask = (id: number) => tasks().find((task) => task.id === id);

	const listTasks = (filter?: (task: Task) => boolean) => {
		const base = filter ? tasks().filter(filter) : tasks();
		if (base.length === 0) {
			push("muted", "没有匹配任务");
			return;
		}
		for (const task of base.slice(0, 50)) push("output", formatTodoTask(task));
	};

	const matches = (task: Task, query: string) => {
		if (!query) return true;
		const q = query.toLowerCase();
		return (
			task.title.toLowerCase().includes(q) ||
			task.tags.some((tag) => tag.name.toLowerCase().includes(q))
		);
	};

	const editTitle = async (id: number, mode: string, text: string) => {
		const task = findTask(id);
		if (!task) {
			push("error", `找不到 #${id}`);
			return;
		}
		const title =
			mode === "replace"
				? text
				: mode === "prepend"
					? `${text} ${task.title}`
					: `${task.title} ${text}`;
		await updateTaskE(id, { title: title.trim() });
		push("output", `#${id} 标题已更新：${title.trim()}`);
	};

	const removeTerm = async (id: number, term: string) => {
		const task = findTask(id);
		if (!task) {
			push("error", `找不到 #${id}`);
			return;
		}
		if (term.startsWith("+") || term.startsWith("@")) {
			const tag = term.slice(1);
			const names = task.tags.map((item) => item.name);
			if (!names.includes(tag)) {
				push("error", `#${id} 没有标签 +${tag}`);
				return;
			}
			await updateTaskE(id, {
				tags: names
					.filter((name) => name !== tag)
					.map((name) => ({ id: -1, name })),
			});
			push("output", `#${id} 已移除标签 +${tag}`);
			return;
		}
		const next = task.title.replaceAll(term, "").replace(/\s+/g, " ").trim();
		if (!next || next === task.title) {
			push("error", `#${id} 标题里没有「${term}」`);
			return;
		}
		await updateTaskE(id, { title: next });
		push("output", `#${id} 已移除「${term}」`);
	};

	const execute = async (command: TodoCommand) => {
		switch (command.kind) {
			case "add": {
				const created = await add({
					title: command.title,
					priority: command.priority,
					tags: command.tags,
					due_at: command.dueAt,
				});
				if (created) push("output", formatTodoTask(created));
				else push("error", "创建失败，原因见提示");
				return;
			}
			case "add-many": {
				let created = 0;
				for (const item of command.items) {
					const task = await add({
						title: item.title,
						priority: item.priority,
						tags: item.tags,
						due_at: item.dueAt,
					});
					if (task) {
						created += 1;
						push("output", formatTodoTask(task));
					}
				}
				push("muted", `共创建 ${created} 条`);
				return;
			}
			case "list": {
				listTasks(
					(task) =>
						task.status !== "completed" &&
						task.status !== "archived" &&
						matches(task, command.query),
				);
				return;
			}
			case "list-all": {
				listTasks((task) => matches(task, command.query));
				return;
			}
			case "list-pri": {
				listTasks(
					(task) =>
						(command.priority === null
							? task.priority !== null
							: task.priority === command.priority) &&
						matches(task, command.query),
				);
				return;
			}
			case "list-tag": {
				listTasks((task) =>
					task.tags.some((tag) =>
						command.tag
							? tag.name.toLowerCase().includes(command.tag.toLowerCase())
							: true,
					),
				);
				if (command.tag === "") {
					push("muted", "以上是带任意标签的任务");
				}
				return;
			}
			case "do":
			case "undo": {
				const status = command.kind === "do" ? "completed" : "backlog";
				let changed = 0;
				for (const id of command.ids) {
					const task = findTask(id);
					if (!task) {
						push("error", `找不到 #${id}（只在当前筛选内查找）`);
						continue;
					}
					await updateStatus(id, status);
					changed += 1;
					push(
						"output",
						`${command.kind === "do" ? "完成" : "重新打开"} #${id} ${task.title}`,
					);
				}
				push("muted", `${changed} 条已更新`);
				return;
			}
			case "delete": {
				if (command.term) {
					await removeTerm(command.ids[0], command.term);
					return;
				}
				const found = command.ids
					.map((id) => findTask(id))
					.filter((task) => task !== undefined);
				if (found.length === 0) {
					push("error", "找不到要删除的任务");
					return;
				}
				const confirmed = await showConfirm({
					title: "删除任务",
					message:
						found.length === 1
							? `确定删除「${found[0]?.title ?? ""}」？子任务也会一并删除。`
							: `确定删除这 ${found.length} 条任务？子任务也会一并删除。`,
					variant: "danger",
					confirmLabel: "删除",
				});
				if (!confirmed) {
					push("muted", "已取消");
					return;
				}
				let removed = 0;
				for (const task of found) {
					try {
						await deleteTaskE(task.id);
						removed += 1;
						push("output", `删除 #${task.id} ${task.title}`);
					} catch (error) {
						push(
							"error",
							`#${task.id} 删除失败：${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}
				await reload();
				await reloadStats();
				push("muted", `共删除 ${removed} 条`);
				return;
			}
			case "edit": {
				await editTitle(command.id, command.mode, command.text);
				return;
			}
			case "pri": {
				const task = findTask(command.id);
				if (!task) {
					push("error", `找不到 #${command.id}`);
					return;
				}
				await updateTaskE(command.id, { priority: command.priority });
				push("output", `#${command.id} 优先级 → ${command.priority}`);
				return;
			}
			case "depri": {
				for (const id of command.ids) {
					const task = findTask(id);
					if (!task) {
						push("error", `找不到 #${id}`);
						continue;
					}
					await updateTaskE(id, { priority: null });
					push("output", `#${id} 已取消优先级`);
				}
				return;
			}
			case "due": {
				const task = findTask(command.id);
				if (!task) {
					push("error", `找不到 #${command.id}`);
					return;
				}
				await updateTaskE(command.id, { due_at: command.dueAt });
				push(
					"output",
					command.dueAt
						? `#${command.id} 截止 → ${command.dueAt.slice(0, 10)}`
						: `#${command.id} 已清除截止`,
				);
				return;
			}
			case "tag": {
				const task = findTask(command.id);
				if (!task) {
					push("error", `找不到 #${command.id}`);
					return;
				}
				const names = task.tags.map((tag) => tag.name);
				const next = command.remove
					? names.filter((name) => name !== command.tag)
					: names.includes(command.tag)
						? names
						: [...names, command.tag];
				await updateTaskE(command.id, {
					tags: next.map((name) => ({ id: -1, name })),
				});
				push(
					"output",
					`#${command.id} ${command.remove ? "移除" : "加上"}标签 +${command.tag}`,
				);
				return;
			}
			case "search": {
				props.onSearch(command.query);
				push("muted", `搜索：${command.query}`);
				return;
			}
			case "archive": {
				if (command.id !== null) {
					const task = findTask(command.id);
					if (!task) {
						push("error", `找不到 #${command.id}`);
						return;
					}
					await updateStatus(command.id, "archived");
					push("output", `归档 #${command.id} ${task.title}`);
					return;
				}
				const completed = tasks().filter((task) => task.status === "completed");
				if (completed.length === 0) {
					push("muted", "没有可归档的已完成任务");
					return;
				}
				for (const task of completed) {
					await updateStatus(task.id, "archived");
				}
				push("output", `归档了 ${completed.length} 条已完成任务`);
				return;
			}
			case "report": {
				const s = stats();
				push(
					"output",
					`待办 ${s.backlog} · 进行中 ${s.active} · 已完成 ${s.completed} · 归档 ${s.archived}`,
				);
				return;
			}
			case "help": {
				if (command.command) {
					const detail =
						COMMAND_DETAILS[command.command] ??
						`没有「${command.command}」的说明`;
					push("muted", detail);
					return;
				}
				for (const line of COMMAND_HELP) push("muted", line);
				return;
			}
			case "clear": {
				setLines([]);
				setExpanded(false);
				return;
			}
			case "error": {
				push("error", command.message);
				return;
			}
		}
	};

	const run = async () => {
		const raw = value().trim();
		if (!raw || busy()) return;
		push("input", `> ${raw}`);
		setHistory((prev) =>
			[...prev.filter((item) => item !== raw), raw].slice(-50),
		);
		setHistoryIndex(-1);
		setValue("");
		setBusy(true);
		try {
			await execute(parseTodoCommand(raw));
		} catch (error) {
			push("error", error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
			queueMicrotask(() => inputRef?.focus());
		}
	};

	const moveHistory = (delta: 1 | -1) => {
		const items = history();
		if (items.length === 0) return;
		const current = historyIndex();
		const next =
			current === -1
				? delta === -1
					? items.length - 1
					: -1
				: Math.min(Math.max(current + delta, -1), items.length - 1);
		setHistoryIndex(next);
		setValue(next === -1 ? "" : items[next]);
	};

	const completeCommand = () => {
		const prefix = value().trim();
		if (!prefix || prefix.includes(" ")) return;
		const match = COMPLETION.find((item) => item.startsWith(prefix));
		if (!match) return;
		setValue(`${match} `);
	};

	return (
		<section class={styles.bar} aria-label="todo.txt 命令栏">
			<div class={styles.inner}>
				<Show when={expanded() && lines().length > 0}>
					<div class={styles.log} ref={logRef} role="log" aria-live="polite">
						<div class={styles.logHead}>
							<span>输出</span>
							<div class={styles.logActions}>
								<button
									type="button"
									onClick={() => setLines([])}
									aria-label="清空输出"
								>
									清空
								</button>
								<button
									type="button"
									onClick={() => setExpanded(false)}
									aria-label="收起输出"
								>
									<ChevronDown size={13} />
								</button>
							</div>
						</div>
						<For each={lines()}>
							{(line) => (
								<p class={styles.line} data-kind={line.kind}>
									{line.text}
								</p>
							)}
						</For>
					</div>
				</Show>

				<div class={styles.inputRow}>
					<span class={styles.icon}>
						<Terminal size={14} />
					</span>
					<span class={styles.prompt} aria-hidden="true">
						&gt;
					</span>
					<input
						ref={inputRef}
						class={styles.input}
						value={value()}
						onInput={(event) => setValue(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !isImeComposing(event)) {
								event.preventDefault();
								void run();
								return;
							}
							if (event.key === "Tab") {
								event.preventDefault();
								completeCommand();
								return;
							}
							if (event.key === "ArrowUp") {
								event.preventDefault();
								moveHistory(-1);
								return;
							}
							if (event.key === "ArrowDown") {
								event.preventDefault();
								moveHistory(1);
								return;
							}
							if (event.key === "Escape") {
								event.preventDefault();
								if (value()) setValue("");
								else {
									setExpanded(false);
									inputRef?.blur();
								}
							}
						}}
						placeholder="todo.txt 命令，输入 help 查看用法"
						aria-label="任务命令"
						autocomplete="off"
						spellcheck={false}
						disabled={busy()}
					/>
					<span class={styles.shortcut}>↑↓ 历史 · Tab 补全</span>
					<Show when={lines().length > 0}>
						<button
							type="button"
							class={styles.toggle}
							onClick={() => setExpanded(!expanded())}
							aria-expanded={expanded()}
							aria-label={expanded() ? "收起命令输出" : "展开命令输出"}
						>
							<Show when={expanded()} fallback={<ChevronUp size={14} />}>
								<ChevronDown size={14} />
							</Show>
						</button>
					</Show>
				</div>
			</div>
		</section>
	);
}
