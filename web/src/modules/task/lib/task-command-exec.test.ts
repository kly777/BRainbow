import { describe, expect, it, vi } from "vite-plus/test";
import type { Task } from "../api.ts";
import {
	executeTaskCommand,
	type TaskCommandDeps,
} from "./task-command-exec.ts";
import { parseTodoCommand } from "./todo-txt.ts";

const task = (over: Partial<Task> = {}): Task => ({
	id: 1,
	title: "写周报",
	description: null,
	parent_task_id: null,
	status: "backlog",
	completed_at: null,
	effort_estimate_minutes: null,
	start_at: null,
	due_at: null,
	priority: null,
	tags: [],
	created_at: "2026-10-01T08:00:00+00:00",
	updated_at: "2026-10-01T08:00:00+00:00",
	...over,
});

function deps(tasks: Task[] = []): TaskCommandDeps {
	return {
		tasks: () => tasks,
		stats: () => ({ backlog: 1, active: 0, completed: 0, archived: 0 }),
		add: vi.fn(async () => task({ id: 9, title: "新任务" })),
		updateStatus: vi.fn(async () => {}),
		updateTaskE: vi.fn(async () => {}),
		removeTasks: vi.fn(async () => true),
		search: vi.fn(),
		confirmDelete: vi.fn(async () => true),
	};
}

const run = async (input: string, d: TaskCommandDeps) => {
	const lines: string[] = [];
	await executeTaskCommand(parseTodoCommand(input), d, (_, text) =>
		lines.push(text),
	);
	return lines;
};

describe("executeTaskCommand", () => {
	it("add 调用 add 并回显任务行", async () => {
		const d = deps();
		const lines = await run("add 新任务", d);
		expect(d.add).toHaveBeenCalledWith(
			expect.objectContaining({ title: "新任务" }),
		);
		expect(lines.join("\n")).toContain("#9 新任务");
	});

	it("do 支持多个 id", async () => {
		const d = deps([task({ id: 1 }), task({ id: 2, title: "第二件" })]);
		await run("do 1 2", d);
		expect(d.updateStatus).toHaveBeenNthCalledWith(1, 1, "completed");
		expect(d.updateStatus).toHaveBeenNthCalledWith(2, 2, "completed");
	});

	it("del <id> <tag> 只移除标签，不删任务", async () => {
		const d = deps([
			task({
				id: 3,
				tags: [
					{ id: 1, name: "工作" },
					{ id: 2, name: "电话" },
				],
			}),
		]);
		await run("del 3 +工作", d);
		expect(d.updateTaskE).toHaveBeenCalledWith(3, {
			tags: [{ id: -1, name: "电话" }],
		});
		expect(d.removeTasks).not.toHaveBeenCalled();
	});

	it("del 多个 id 先确认，再统一删除", async () => {
		const d = deps([task({ id: 1 }), task({ id: 2 })]);
		await run("del 1 2", d);
		expect(d.confirmDelete).toHaveBeenCalledTimes(1);
		expect(d.removeTasks).toHaveBeenCalledWith([1, 2]);
	});

	it("取消确认时不删除", async () => {
		const d = deps([task({ id: 1 })]);
		d.confirmDelete = vi.fn(async () => false);
		await run("del 1", d);
		expect(d.removeTasks).not.toHaveBeenCalled();
	});
});
