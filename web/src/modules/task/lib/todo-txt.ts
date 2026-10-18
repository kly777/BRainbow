// ── todo.txt 风格命令解析 ──
//
// 参考 todo.txt-cli 的命令面：add / addm / append / prepend / replace /
// do / undo / del / pri / depri / due / tag / listpri / listproj / listcon /
// listall / search / archive / report / help。这里只做**纯解析**，执行在
// TaskCommandBar 里通过现有 task API/provider 完成。

import type { TaskPriority } from "../api-types.ts";

export interface TodoText {
	title: string;
	priority: TaskPriority | null;
	tags: string[];
	dueAt: string | null;
}

export type TodoCommand =
	| ({ kind: "add" } & TodoText)
	| { kind: "add-many"; items: TodoText[] }
	| { kind: "list"; query: string }
	| { kind: "list-all"; query: string }
	| { kind: "list-pri"; priority: TaskPriority | null; query: string }
	| { kind: "list-tag"; tag: string }
	| { kind: "do"; ids: number[] }
	| { kind: "undo"; ids: number[] }
	| { kind: "delete"; ids: number[]; term?: string }
	| {
			kind: "edit";
			id: number;
			mode: "append" | "prepend" | "replace";
			text: string;
	  }
	| { kind: "pri"; id: number; priority: TaskPriority }
	| { kind: "depri"; ids: number[] }
	| { kind: "due"; id: number; dueAt: string | null }
	| { kind: "tag"; id: number; tag: string; remove: boolean }
	| { kind: "search"; query: string }
	| { kind: "archive"; id: number | null }
	| { kind: "report" }
	| { kind: "help"; command: string }
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
	"addm 任务一 | 任务二 | 任务三",
	"append <id> <追加内容> / prepend <id> <前置内容>",
	"replace <id> <新标题>",
	"list [关键词] / listall [关键词]",
	"listpri [A-D] / listproj [+标签] / listcon [@标签]",
	"do <id...> / undo <id...>",
	"del <id...> [要移除的词]",
	"pri <id> <A-D> / depri <id...>",
	"due <id> <YYYY-MM-DD|none>",
	"tag <id> +标签 / untag <id> +标签",
	"search <关键词>",
	"archive [id]（不填 id 归档所有已完成）",
	"report / help [命令] / clear",
] as const;

export const COMMAND_DETAILS: Record<string, string> = {
	add: "add (A) 写周报 +工作 @电话 due:2026-10-20 — 创建任务",
	addm: "addm 任务一 | 任务二 — 用 | 分隔一次创建多条",
	append: "append <id> 文本 — 追加到标题末尾",
	prepend: "prepend <id> 文本 — 插到标题开头",
	replace: "replace <id> 新标题 — 整体替换标题",
	list: "list [关键词] — 列出当前筛选内的任务",
	listall: "listall [关键词] — 列出含已完成的任务",
	listpri: "listpri [A-D] — 按优先级列出任务",
	listproj: "listproj [+标签] — 按标签列出任务",
	listcon: "listcon [@标签] — 同 listproj，@ 只是写法",
	do: "do <id...> — 标记完成，支持多个 id",
	undo: "undo <id...> — 重新打开",
	del: "del <id...> — 删除任务；del <id> 词 — 只从任务里移除该词",
	pri: "pri <id> <A-D> — 设置优先级",
	depri: "depri <id...> — 清除优先级",
	due: "due <id> <YYYY-MM-DD|none> — 设置/清除截止",
	tag: "tag <id> +标签 — 添加标签",
	untag: "untag <id> +标签 — 移除标签",
	search: "search 关键词 — 搜索任务",
	archive: "archive [id] — 归档；不填 id 归档所有已完成",
	report: "report — 显示任务统计",
	help: "help [命令] — 查看命令说明",
	clear: "clear — 清空命令输出",
};

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

/** `3 5 8` / `3,5,8` / `#3 #5` → 去重后的 id 列表 */
function parseIds(tokens: readonly string[]): number[] | null {
	const parts = tokens
		.join(" ")
		.split(/[,\s]+/)
		.filter(Boolean);
	if (parts.length === 0) return null;
	const ids: number[] = [];
	for (const part of parts) {
		const id = parseId(part);
		if (id === null) return null;
		if (!ids.includes(id)) ids.push(id);
	}
	return ids;
}

/** 解析 add 后面的 todo.txt 正文 */
export function parseTodoText(input: string): TodoText {
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
		case "addm": {
			const items = arg
				.split(/\s*\|\s*|\n+/)
				.map((item) => parseTodoText(item))
				.filter((item) => item.title.length > 0);
			if (items.length === 0) {
				return {
					kind: "error",
					message: "用法：addm 任务一 | 任务二 | 任务三",
				};
			}
			return { kind: "add-many", items };
		}
		case "list":
		case "ls":
			return { kind: "list", query: arg };
		case "listall":
		case "lsa":
			return { kind: "list-all", query: arg };
		case "listpri":
		case "lsp": {
			const first = rest[0]?.toUpperCase();
			const priority = first && /^[A-D]$/.test(first) ? PRIORITY[first] : null;
			return {
				kind: "list-pri",
				priority,
				query: (priority ? rest.slice(1) : rest).join(" ").trim(),
			};
		}
		case "listproj":
		case "lsprj":
		case "listcon":
		case "lsc":
			return { kind: "list-tag", tag: arg.replace(/^[+@]/, "").trim() };
		case "do":
		case "done":
		case "complete": {
			const ids = parseIds(rest);
			return ids
				? { kind: "do", ids }
				: { kind: "error", message: "do 后面要跟任务 id，可写多个" };
		}
		case "undo":
		case "undone":
		case "activate": {
			const ids = parseIds(rest);
			return ids
				? { kind: "undo", ids }
				: { kind: "error", message: "undo 后面要跟任务 id，可写多个" };
		}
		case "del":
		case "delete":
		case "rm": {
			const tokens = rest
				.join(" ")
				.split(/[,\s]+/)
				.filter(Boolean);
			const allIds =
				tokens.length > 0 && tokens.every((token) => parseId(token));
			if (allIds) {
				const ids = parseIds(tokens);
				return ids
					? { kind: "delete", ids }
					: { kind: "error", message: "del 后面要跟任务 id" };
			}
			const id = parseId(rest[0]);
			if (!id) return { kind: "error", message: "del 后面要跟任务 id" };
			const term = rest.slice(1).join(" ").trim();
			return term
				? { kind: "delete", ids: [id], term }
				: { kind: "delete", ids: [id] };
		}
		case "append":
		case "app":
		case "prepend":
		case "prep":
		case "replace": {
			const id = parseId(rest[0]);
			const text = rest.slice(1).join(" ").trim();
			if (!id || !text) {
				return {
					kind: "error",
					message: `${command} 用法：${command} <id> <文本>`,
				};
			}
			const mode =
				command === "replace"
					? "replace"
					: command.startsWith("pre")
						? "prepend"
						: "append";
			return { kind: "edit", id, mode, text };
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
			const ids = parseIds(rest);
			return ids
				? { kind: "depri", ids }
				: { kind: "error", message: "depri 后面要跟任务 id，可写多个" };
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
			return { kind: "help", command: rest[0]?.toLowerCase() ?? "" };
		case "clear":
			return { kind: "clear" };
		default:
			return {
				kind: "error",
				message: `未知命令：${name}。输入 help 查看命令。`,
			};
	}
}
