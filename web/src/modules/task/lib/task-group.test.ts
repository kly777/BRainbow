import type { Task } from "@modules/task";
import { describe, expect, it } from "vitest";
import { buildChildrenMap, groupByStatus } from "./task-group.ts";

/** 只给关心的字段，其余走默认（Task 的必填字段较多） */
const task = (id: number, over: Partial<Task> = {}): Task =>
	({
		id,
		title: `t${id}`,
		description: null,
		parent_task_id: null,
		status: "backlog",
		completed_at: null,
		effort_estimate_minutes: null,
		created_at: "2026-09-01T00:00:00+00:00",
		updated_at: "2026-09-01T00:00:00+00:00",
		...over,
	}) as Task;

describe("buildChildrenMap", () => {
	it("空列表 → 空表", () => {
		expect(buildChildrenMap([]).size).toBe(0);
	});

	it("没有 parent_task_id 的任务不进表", () => {
		expect(buildChildrenMap([task(1), task(2)]).size).toBe(0);
	});

	it("同一父任务的多个子任务按传入顺序聚集", () => {
		const map = buildChildrenMap([
			task(2, { parent_task_id: 1 }),
			task(3, { parent_task_id: 1 }),
			task(4, { parent_task_id: 2 }),
		]);
		expect(map.get(1)?.map((t) => t.id)).toEqual([2, 3]);
		expect(map.get(2)?.map((t) => t.id)).toEqual([4]);
	});
});

describe("groupByStatus", () => {
	it("四个分组始终存在（空数组也要在，渲染层直接取下标）", () => {
		const grouped = groupByStatus([]);
		expect(Object.keys(grouped)).toEqual([
			"backlog",
			"active",
			"completed",
			"archived",
		]);
		expect(grouped.backlog).toEqual([]);
	});

	it("status 缺省（空串）归 backlog", () => {
		const grouped = groupByStatus([task(1, { status: "" })]);
		expect(grouped.backlog.map((t) => t.id)).toEqual([1]);
	});

	it("未知状态不进任何分组（不新造分组）", () => {
		const grouped = groupByStatus([task(1, { status: "someday" })]);
		const all = Object.values(grouped).flat();
		expect(all).toEqual([]);
	});

	it("组内保持传入顺序", () => {
		const grouped = groupByStatus([
			task(1, { status: "active" }),
			task(2, { status: "completed" }),
			task(3, { status: "active" }),
		]);
		expect(grouped.active.map((t) => t.id)).toEqual([1, 3]);
		expect(grouped.completed.map((t) => t.id)).toEqual([2]);
	});
});
