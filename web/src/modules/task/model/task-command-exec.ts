// ── todo.txt 命令执行器（不依赖 Solid / DOM）──
//
// 解析在 todo-txt.ts，纯 UI 在 TaskCommandBar；这里把「命令 → 任务变更」
// 收成一个可注入依赖的函数，命令执行因此可以用 fake 直接测。

import type { CreateTaskRequest, Task, TaskStats } from "../api.ts";
import {
	COMMAND_DETAILS,
	COMMAND_HELP,
	formatTodoTask,
	type TodoCommand,
} from "./todo-txt.ts";

export type CommandOutputKind = "output" | "error" | "muted";
export type CommandOutput = (kind: CommandOutputKind, text: string) => void;

export interface TaskCommandDeps {
	tasks: () => readonly Task[];
	stats: () => TaskStats;
	add: (request: CreateTaskRequest) => Promise<Task | null>;
	updateStatus: (id: number, status: Task["status"]) => Promise<void>;
	updateTaskE: (id: number, updates: Partial<Task>) => Promise<void>;
	/** 调用前已经确认；返回是否成功 */
	removeTasks: (ids: number[]) => Promise<boolean>;
	search: (query: string) => void;
	confirmDelete: (tasks: readonly Task[]) => Promise<boolean>;
}

export async function executeTaskCommand(
	command: TodoCommand,
	deps: TaskCommandDeps,
	output: CommandOutput,
): Promise<void> {
	const findTask = (id: number) => deps.tasks().find((task) => task.id === id);

	const listTasks = (filter?: (task: Task) => boolean) => {
		const base = filter ? deps.tasks().filter(filter) : deps.tasks();
		if (base.length === 0) {
			output("muted", "没有匹配任务");
			return;
		}
		for (const task of base.slice(0, 50)) {
			output("output", formatTodoTask(task));
		}
	};

	const matches = (task: Task, query: string) => {
		if (!query) return true;
		const q = query.toLowerCase();
		return (
			task.title.toLowerCase().includes(q) ||
			task.tags.some((tag) => tag.name.toLowerCase().includes(q))
		);
	};

	const editTitle = async (
		id: number,
		mode: "append" | "prepend" | "replace",
		text: string,
	) => {
		const task = findTask(id);
		if (!task) {
			output("error", `找不到 #${id}`);
			return;
		}
		const title =
			mode === "replace"
				? text
				: mode === "prepend"
					? `${text} ${task.title}`
					: `${task.title} ${text}`;
		await deps.updateTaskE(id, { title: title.trim() });
		output("output", `#${id} 标题已更新：${title.trim()}`);
	};

	const removeTerm = async (id: number, term: string) => {
		const task = findTask(id);
		if (!task) {
			output("error", `找不到 #${id}`);
			return;
		}
		if (term.startsWith("+") || term.startsWith("@")) {
			const tag = term.slice(1);
			const names = task.tags.map((item) => item.name);
			if (!names.includes(tag)) {
				output("error", `#${id} 没有标签 +${tag}`);
				return;
			}
			await deps.updateTaskE(id, {
				tags: names
					.filter((name) => name !== tag)
					.map((name) => ({ id: -1, name })),
			});
			output("output", `#${id} 已移除标签 +${tag}`);
			return;
		}
		const next = task.title.replaceAll(term, "").replace(/\s+/g, " ").trim();
		if (!next || next === task.title) {
			output("error", `#${id} 标题里没有「${term}」`);
			return;
		}
		await deps.updateTaskE(id, { title: next });
		output("output", `#${id} 已移除「${term}」`);
	};

	switch (command.kind) {
		case "add": {
			const created = await deps.add({
				title: command.title,
				priority: command.priority,
				tags: command.tags,
				due_at: command.dueAt,
			});
			if (created) output("output", formatTodoTask(created));
			else output("error", "创建失败，原因见提示");
			return;
		}
		case "add-many": {
			let created = 0;
			for (const item of command.items) {
				const task = await deps.add({
					title: item.title,
					priority: item.priority,
					tags: item.tags,
					due_at: item.dueAt,
				});
				if (task) {
					created += 1;
					output("output", formatTodoTask(task));
				}
			}
			output("muted", `共创建 ${created} 条`);
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
				output("muted", "以上是带任意标签的任务");
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
					output("error", `找不到 #${id}（只在当前筛选内查找）`);
					continue;
				}
				await deps.updateStatus(id, status);
				changed += 1;
				output(
					"output",
					`${command.kind === "do" ? "完成" : "重新打开"} #${id} ${task.title}`,
				);
			}
			output("muted", `${changed} 条已更新`);
			return;
		}
		case "delete": {
			if (command.term) {
				const id = command.ids[0];
				if (id === undefined) {
					output("error", "删除任务缺少 id");
					return;
				}
				await removeTerm(id, command.term);
				return;
			}
			const found = command.ids
				.map((id) => findTask(id))
				.filter((task) => task !== undefined);
			if (found.length === 0) {
				output("error", "找不到要删除的任务");
				return;
			}
			if (!(await deps.confirmDelete(found))) {
				output("muted", "已取消");
				return;
			}
			if (!(await deps.removeTasks(found.map((task) => task.id)))) {
				return;
			}
			for (const task of found) {
				output("output", `删除 #${task.id} ${task.title}`);
			}
			output("muted", `共删除 ${found.length} 条`);
			return;
		}
		case "edit": {
			await editTitle(command.id, command.mode, command.text);
			return;
		}
		case "pri": {
			const task = findTask(command.id);
			if (!task) {
				output("error", `找不到 #${command.id}`);
				return;
			}
			await deps.updateTaskE(command.id, { priority: command.priority });
			output("output", `#${command.id} 优先级 → ${command.priority}`);
			return;
		}
		case "depri": {
			for (const id of command.ids) {
				const task = findTask(id);
				if (!task) {
					output("error", `找不到 #${id}`);
					continue;
				}
				await deps.updateTaskE(id, { priority: null });
				output("output", `#${id} 已取消优先级`);
			}
			return;
		}
		case "due": {
			const task = findTask(command.id);
			if (!task) {
				output("error", `找不到 #${command.id}`);
				return;
			}
			await deps.updateTaskE(command.id, { due_at: command.dueAt });
			output(
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
				output("error", `找不到 #${command.id}`);
				return;
			}
			const names = task.tags.map((tag) => tag.name);
			const next = command.remove
				? names.filter((name) => name !== command.tag)
				: names.includes(command.tag)
					? names
					: [...names, command.tag];
			await deps.updateTaskE(command.id, {
				tags: next.map((name) => ({ id: -1, name })),
			});
			output(
				"output",
				`#${command.id} ${command.remove ? "移除" : "加上"}标签 +${command.tag}`,
			);
			return;
		}
		case "search": {
			deps.search(command.query);
			output("muted", `搜索：${command.query}`);
			return;
		}
		case "archive": {
			if (command.id !== null) {
				const task = findTask(command.id);
				if (!task) {
					output("error", `找不到 #${command.id}`);
					return;
				}
				await deps.updateStatus(command.id, "archived");
				output("output", `归档 #${command.id} ${task.title}`);
				return;
			}
			const completed = deps
				.tasks()
				.filter((task) => task.status === "completed");
			if (completed.length === 0) {
				output("muted", "没有可归档的已完成任务");
				return;
			}
			for (const task of completed) {
				await deps.updateStatus(task.id, "archived");
			}
			output("output", `归档了 ${completed.length} 条已完成任务`);
			return;
		}
		case "report": {
			const s = deps.stats();
			output(
				"output",
				`待办 ${s.backlog} · 进行中 ${s.active} · 已完成 ${s.completed} · 归档 ${s.archived}`,
			);
			return;
		}
		case "help": {
			if (command.command) {
				output(
					"muted",
					COMMAND_DETAILS[command.command] ??
						`没有「${command.command}」的说明`,
				);
				return;
			}
			for (const line of COMMAND_HELP) output("muted", line);
			return;
		}
		case "clear":
			return;
		case "error": {
			output("error", command.message);
			return;
		}
	}
}
