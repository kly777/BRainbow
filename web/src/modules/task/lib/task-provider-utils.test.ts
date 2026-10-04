import { describe, expect, it } from "vitest";
import { makeTemp, STATUS_API } from "./task-provider-utils.ts";

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

describe("STATUS_API", () => {
	it("has all expected status keys", () => {
		// 键**覆盖**这件事现在由类型保证（`Record<TaskStatus, …>` 少一个就编不过），
		// 这条断言留下来是为了"具体是哪四个"仍有据可查，而不是靠翻代码。
		expect(Object.keys(STATUS_API).sort()).toEqual([
			"active",
			"archived",
			"backlog",
			"completed",
		]);
	});

	it("每个状态都挂了 API 调用", () => {
		// `Object.keys` 给的是 `string[]`，索引 `Record<TaskStatus, …>` 需要断言；
		// `Object.values` 不用断言，于是用后者 —— 断言正是这次要消掉的东西。
		for (const fn of Object.values(STATUS_API)) {
			expect(typeof fn).toBe("function");
		}
	});
});
