// ── todo.txt 风格命令解析 ──
//
// 参考 todo.txt-cli 的命令面：add / list / do / undo / del / pri / depri /
// due / tag / search / archive / report / help。这里只做**纯解析**，执行在
// TaskCommandConsole 里通过现有 task API/provider 完成。
//
// todo.txt 文本约定：
//   (A) 写周报 +工作 @电话 due:2026-10-20
//   - 行首 (A)-(D) → p1-p4
//   - +project / @context → 都收进标签（本项目没有 project/context 分表）
//   - due:YYYY-MM-DD → 当天本地 23:59
//   - 其余文字就是标题

import type { TaskPriority } from "../api-types.ts";

export type TodoCommand =
	| {
			kind: "add";
			title: string;
			priority: TaskPriority | null;
			tags: string[];
			dueAt: string | null;
	  }
	| { kind: "list"; query: string }
	| { kind: "do"; id: number }
	| { kind: "undo"; id: number }
	| { kind: "delete"; id: number }
	| { kind: "pri"; id: number; priority: TaskPriority }
	| { kind: "depri"; id: number }
	| { kind: "due"; id: number; dueAt: string | null }
	| { kind: "tag"; id: number; tag: string; remove: boolean }
	| { kind: "search"; query: string }
	| { kind: "archive"; id: number | null }
	| { kind: "report" }
	| { kind: "help" }
	| { kind: "clear" }
	| { kind: "error"; message: string };

const PRIORITY: Record<string, TaskPriority> = {
	A: "p1",
	B: "p2",
	C: "p3",
	D: "p4",
};

const PRIORITY_NAME: Record<TaskPriority, string> = {
	p1: "A",
	p2: "B",
	p3: "C",
	p4: "D",
};

export const COMMAND_HELP = [
	"add (A) 写周报 +工作 @电话 due:2026-10-20",
	"list [关键词]",
	"do <id> / undo <id>",
	"del <id>",
	"pri <id> <A-D> / pri <A-D> <id>",
	"depri <id>",
	"due <id> <YYYY-MM-DD|none>",
	"tag <id> +标签 / untag <id> +标签",
	"search <关键词>",
	"archive [id]（不填 id 归档所有已完成）",
	"report / help / clear",
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function localDayEnd(date: string): string | null {
	if (!DATE_RE.test(date)) return null;
	const [year, month, day] = date.split("-").map(Number);
	const value = new Date(year, month - 1, day, 23, 59, 0, 0);
	if (
		value.getFullYear() !== year ||
		value.getMonth() !== month - 1 ||
		value.getDate() !== day
	) {
		return null;
	}
	return value.toISOString();
}

function parseId(raw: string | undefined): number | null {
	if (!raw) return null;
	const text = raw.replace(/^#/, "");
	if (!/^\d+$/.test(text)) return null;
	const id = Number(text);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** 解析 add 后面的 todo.txt 正文 */
export function parseTodoText(input: string): {
	title: string;
	priority: TaskPriority | null;
	tags: string[];
	dueAt: string | null;
} {
	let text = input.trim();
	let priority: TaskPriority | null = null;

	const priorityMatch = text.match(/^\(([A-Za-z])\)\s+/);
	if (priorityMatch) {
		priority = PRIORITY[priorityMatch[1].toUpperCase()] ?? null;
		if (priority) {
			text = text.slice(priorityMatch[0].length);
		}
	}

	const dueMatch = text.match(/\bdue:(\d{4}-\d{2}-\d{2})\b/i);
	const dueAt = dueMatch ? localDayEnd(dueMatch[1]) : null;
	if (dueMatch) text = text.replace(dueMatch[0], " ");

	const tags: string[] = [];
	text = text.replace(/[+@](\S+)/g, (_, raw: string) => {
		const tag = raw.trim();
		if (tag && !tags.includes(tag)) tags.push(tag);
		return " ";
	});

	text = text.replace(/\s+/g, " ").trim();

	// 兼容录入框已有的 !p1 写法
	const bang = text.match(/(?:^|\s)!p([1-4])(?=\s|$)/i);
	if (!priority && bang) {
		priority = `p${bang[1]}` as TaskPriority;
		text = text.replace(bang[0], " ").replace(/\s+/g, " ").trim();
	}

	return { title: text, priority, tags, dueAt };
}

/** 一行任务的 todo.txt 展示 */
export function formatTodoTask(task: {
	id: number;
	title: string;
	status: string;
	priority: TaskPriority | null;
	tags: { name: string }[];
	due_at: string | null;
}): string {
	const done = task.status === "completed" ? "x " : "";
	const priority = task.priority ? `(${PRIORITY_NAME[task.priority]}) ` : "";
	const tags = task.tags.map((tag) => `+${tag.name}`).join(" ");
	const due = task.due_at
		? ` due:${new Date(task.due_at).toLocaleDateString("sv-SE")}`
		: "";
	return `${done}#${task.id} ${priority}${task.title}${tags ? ` ${tags}` : ""}${due}`;
}

/** 解析一整条命令 */
export function parseTodoCommand(input: string): TodoCommand {
	const raw = input.trim();
	if (!raw) return { kind: "error", message: "请输入命令" };

	const [name, ...rest] = raw.split(/\s+/);
	const command = name.toLowerCase();
	const arg = rest.join(" ").trim();

	switch (command) {
		case "add":
		case "a": {
			const parsed = parseTodoText(arg);
			if (!parsed.title) {
				return {
					kind: "error",
					message: "add 后面要有任务标题，例如 add (A) 写周报 +工作",
				};
			}
			return { kind: "add", ...parsed };
		}
		case "list":
		case "ls":
			return { kind: "list", query: arg };
		case "do":
		case "done":
		case "complete": {
			const id = parseId(rest[0]);
			return id
				? { kind: "do", id }
				: { kind: "error", message: "do 后面要跟任务 id" };
		}
		case "undo":
		case "undone":
		case "activate": {
			const id = parseId(rest[0]);
			return id
				? { kind: "undo", id }
				: { kind: "error", message: "undo 后面要跟任务 id" };
		}
		case "del":
		case "delete":
		case "rm": {
			const id = parseId(rest[0]);
			return id
				? { kind: "delete", id }
				: { kind: "error", message: "del 后面要跟任务 id" };
		}
		case "pri":
		case "priority": {
			const id = parseId(rest[0]) ?? parseId(rest[1]);
			const letter = rest.find((item) => /^[A-Da-d]$/.test(item));
			const priority = letter ? PRIORITY[letter.toUpperCase()] : undefined;
			if (!id || !priority) {
				return {
					kind: "error",
					message: "用法：pri <id> <A-D> 或 pri <A-D> <id>",
				};
			}
			return { kind: "pri", id, priority };
		}
		case "depri":
		case "deprioritize": {
			const id = parseId(rest[0]);
			return id
				? { kind: "depri", id }
				: { kind: "error", message: "depri 后面要跟任务 id" };
		}
		case "due": {
			const id = parseId(rest[0]);
			const value = rest[1]?.toLowerCase();
			if (!id || !value) {
				return { kind: "error", message: "用法：due <id> <YYYY-MM-DD|none>" };
			}
			if (value === "none" || value === "-") {
				return { kind: "due", id, dueAt: null };
			}
			const dueAt = localDayEnd(value);
			return dueAt
				? { kind: "due", id, dueAt }
				: { kind: "error", message: "日期格式应为 YYYY-MM-DD" };
		}
		case "tag":
		case "untag": {
			const id = parseId(rest[0]);
			const tag = rest[1]?.replace(/^[+@]/, "").trim();
			if (!id || !tag) {
				return { kind: "error", message: "用法：tag <id> +标签" };
			}
			return { kind: "tag", id, tag, remove: command === "untag" };
		}
		case "search":
		case "find": {
			if (!arg) return { kind: "error", message: "search 后面要跟关键词" };
			return { kind: "search", query: arg };
		}
		case "archive": {
			if (!arg) return { kind: "archive", id: null };
			const id = parseId(arg);
			return id
				? { kind: "archive", id }
				: { kind: "error", message: "archive 后面只能跟任务 id" };
		}
		case "report":
		case "stats":
			return { kind: "report" };
		case "help":
		case "?":
			return { kind: "help" };
		case "clear":
			return { kind: "clear" };
		default:
			return {
				kind: "error",
				message: `未知命令：${name}。输入 help 查看命令。`,
			};
	}
}
