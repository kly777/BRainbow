// ── /task 底部常驻命令栏 ──
//
// 解析在 model/todo-txt.ts，执行在 model/task-command-exec.ts（纯逻辑、可注入依赖）。
// 这里只负责输入/历史/输出与确认框；命令栏常驻页面底部，回车后在上方展开输出。

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
import { useTasks } from "../data/TaskProvider.tsx";
import { executeTaskCommand } from "../model/task-command-exec.ts";
import { parseTodoCommand, type TodoCommand } from "../model/todo-txt.ts";
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
	const { tasks, stats, add, updateStatus, updateTaskE, removeTasks } =
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

	const confirmDelete = async (found: readonly { title: string }[]) =>
		showConfirm({
			title: "删除任务",
			message:
				found.length === 1
					? `确定删除「${found[0]?.title ?? ""}」？未完成的任务会移入归档，已完成的任务会永久删除。`
					: `确定删除这 ${found.length} 条任务？未完成的任务会移入归档，已完成的任务会永久删除。`,
			variant: "danger",
			confirmLabel: "删除",
		});

	const execute = async (command: TodoCommand) => {
		if (command.kind === "clear") {
			setLines([]);
			setExpanded(false);
			return;
		}
		await executeTaskCommand(
			command,
			{
				tasks,
				stats,
				add,
				updateStatus,
				updateTaskE,
				removeTasks,
				search: props.onSearch,
				confirmDelete,
			},
			push,
		);
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
