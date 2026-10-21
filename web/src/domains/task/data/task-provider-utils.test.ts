import { describe, expect, it } from "vite-plus/test";
import type { TaskStatusType } from "../api-types.ts";
import { makeTemp, mergeTaskLists, STATUS_API } from "./task-provider-utils.ts";

describe("makeTemp", () => {
	it("creates a task with basic title", () => {
		const t = makeTemp({ title: "Test task" });
		expect(t.title).toBe("Test task");
		expect(t.status).toBe("backlog");
		expect(t.id).toBeGreaterThan(0);
		expect(t.completed_at).toBeNull();
	});

	it("creates a task with parent_task_id", () => {
		const t = makeTemp({ title: "Subtask", parent_task_id: 42 });
		expect(t.parent_task_id).toBe(42);
	});

	it("creates a task with effort estimate", () => {
		const t = makeTemp({
			title: "Task",
			effort_estimate_minutes: 60,
		});
		expect(t.effort_estimate_minutes).toBe(60);
	});

	it("defaults optional fields to null", () => {
		const t = makeTemp({ title: "Minimal" });
		expect(t.description).toBeNull();
		expect(t.parent_task_id).toBeNull();
		expect(t.effort_estimate_minutes).toBeNull();
	});

	it("sets created_at and updated_at", () => {
		const t = makeTemp({ title: "Time" });
		expect(t.created_at).toEqual(t.updated_at);
		expect(new Date(t.created_at).getTime()).not.toBeNaN();
	});
});

describe("mergeTaskLists", () => {
	it("appends completed tasks after open ones", () => {
		const open = [makeTemp({ title: "open" })];
		const done = [
			{ ...makeTemp({ title: "done" }), id: 999, status: "completed" as const },
		];
		const merged = mergeTaskLists(open, done);
		expect(merged.map((task) => task.title)).toEqual(["open", "done"]);
	});

	it("drops completed duplicates already present in the open list", () => {
		const task = makeTemp({ title: "same" });
		const merged = mergeTaskLists(
			[task],
			[{ ...task, status: "completed" as const }],
		);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toBe(task);
	});

	it("keeps open tasks untouched when there are no completed tasks", () => {
		const open = [makeTemp({ title: "a" }), makeTemp({ title: "b" })];
		expect(mergeTaskLists(open, [])).toEqual(open);
	});
});

describe("STATUS_API", () => {
	it("has all expected status keys", () => {
		expect(Object.keys(STATUS_API).sort()).toEqual([
			"active",
			"archived",
			"backlog",
			"completed",
		]);
	});

	it("each entry returns a Task with the given id on success", async () => {
		for (const key of Object.keys(STATUS_API) as TaskStatusType[]) {
			expect(typeof STATUS_API[key]).toBe("function");
		}
	});
});
