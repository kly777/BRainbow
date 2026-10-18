// ── todo.txt 风格命令台 ──
//
// 命令解析在 lib/todo-txt.ts（纯函数，有测试）。这里只负责输入/历史/输出，
// 执行一律走 TaskProvider 已有的 add / updateStatus / updateTaskE / removeTask。

import { createEffect, createSignal, For, Show } from "solid-js";
import { isImeComposing } from "@shared/utils";
import { showConfirm } from "@components/ui";
import { Terminal, X } from "@components/ui/icons";
import { deleteTaskE } from "../api.ts";
import { useTasks } from "../components/TaskProvider.tsx";
import {
	COMMAND_HELP,
	formatTodoTask,
	parseTodoCommand,
	type TodoCommand,
} from "../lib/todo-txt.ts";
import styles from "./TaskCommandConsole.module.css";

interface Line {
	kind: "input" | "output" | "error" | "muted";
	text: string;
}

export interface TaskCommandConsoleProps {
	isOpen: boolean;
	onClose: () => void;
	onSearch: (query: string) => void;
}

export default function TaskCommandConsole(props: TaskCommandConsoleProps) {
	const { tasks, stats, add, updateStatus, updateTaskE, reload, reloadStats } =
		useTasks();
	const [lines, setLines] = createSignal<Line[]>([
		{ kind: "muted", text: "todo.txt 命令 · 输入 help 查看用法" },
	]);
	const [value, setValue] = createSignal("");
	const [history, setHistory] = createSignal<string[]>([]);
	const [historyIndex, setHistoryIndex] = createSignal(-1);
	const [busy, setBusy] = createSignal(false);
	let inputRef: HTMLInputElement | undefined;
	let logRef: HTMLDivElement | undefined;

	const push = (kind: Line["kind"], text: string) => {
		setLines((prev) => [...prev, { kind, text }].slice(-200));
	};

	createEffect(() => {
		if (!props.isOpen) return;
		queueMicrotask(() => inputRef?.focus());
	});

	createEffect(() => {
		lines();
		queueMicrotask(() => {
			if (logRef) logRef.scrollTop = logRef.scrollHeight;
		});
	});

	const findTask = (id: number) => tasks().find((task) => task.id === id);

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
			case "list": {
				const query = command.query.toLowerCase();
				const matched = tasks()
					.filter((task) => {
						if (!query) return true;
						return (
							task.title.toLowerCase().includes(query) ||
							task.tags.some((tag) => tag.name.toLowerCase().includes(query))
						);
					})
					.slice(0, 50);
				if (matched.length === 0) push("muted", "没有匹配任务");
				else for (const task of matched) push("output", formatTodoTask(task));
				return;
			}
			case "do":
			case "undo": {
				const task = findTask(command.id);
				if (!task) {
					push("error", `找不到 #${command.id}（只在当前筛选内查找）`);
					return;
				}
				const status = command.kind === "do" ? "completed" : "backlog";
				await updateStatus(command.id, status);
				push(
					"output",
					`${command.kind === "do" ? "完成" : "重新打开"} #${command.id} ${task.title}`,
				);
				return;
			}
			case "delete": {
				const task = findTask(command.id);
				if (!task) {
					push("error", `找不到 #${command.id}（只在当前筛选内查找）`);
					return;
				}
				const confirmed = await showConfirm({
					title: "删除任务",
					message: `确定删除「${task.title}」？子任务也会一并删除。`,
					variant: "danger",
					confirmLabel: "删除",
				});
				if (!confirmed) {
					push("muted", "已取消");
					return;
				}
				try {
					await deleteTaskE(command.id);
					await reload();
					await reloadStats();
					push("output", `删除 #${command.id} ${task.title}`);
				} catch (error) {
					push("error", error instanceof Error ? error.message : String(error));
				}
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
				const task = findTask(command.id);
				if (!task) {
					push("error", `找不到 #${command.id}`);
					return;
				}
				await updateTaskE(command.id, { priority: null });
				push("output", `#${command.id} 已取消优先级`);
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
				for (const line of COMMAND_HELP) push("muted", line);
				return;
			}
			case "clear": {
				setLines([]);
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

	return (
		<Show when={props.isOpen}>
			<section
				class={styles.console}
				aria-label="todo.txt 命令台"
				role="dialog"
				aria-modal="false"
			>
				<header class={styles.head}>
					<span class={styles.promptIcon}>
						<Terminal size={14} />
					</span>
					<strong class={styles.headTitle}>todo.txt</strong>
					<span class={styles.headHint}>命令管理</span>
					<button
						type="button"
						class={styles.close}
						onClick={props.onClose}
						aria-label="关闭命令台"
					>
						<X size={14} />
					</button>
				</header>

				<div class={styles.log} ref={logRef} role="log" aria-live="polite">
					<For each={lines()}>
						{(line) => (
							<p class={styles.line} data-kind={line.kind}>
								{line.text}
							</p>
						)}
					</For>
				</div>

				<div class={styles.inputRow}>
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
								else props.onClose();
							}
						}}
						placeholder="add (A) 写周报 +工作 due:2026-10-20"
						aria-label="任务命令"
						autocomplete="off"
						spellcheck={false}
						disabled={busy()}
					/>
				</div>

				<footer class={styles.foot}>
					<span>↑↓ 历史</span>
					<span>Esc {value() ? "清空" : "关闭"}</span>
					<span>help</span>
				</footer>
			</section>
		</Show>
	);
}
