// @vitest-environment jsdom
// 筛选规则的单测：条件之间是「且」、同一条件多值是「或」、空条件等价于不筛。

import { describe, expect, it } from "vite-plus/test";
import type { Task, TaskPriority, TaskStatusType } from "../api-types.ts";
import {
	applyFilter,
	type FilterChip,
	filterChips,
	isFilterEmpty,
	matchesFilter,
	removeChip,
	toggleValue,
} from "./task-filter.ts";

const task = (id: number, over: Partial<Task> = {}): Task =>
	({
		id,
		title: `t${id}`,
		description: null,
		parent_task_id: null,
		status: "backlog",
		completed_at: null,
		effort_estimate_minutes: null,
		start_at: null,
		due_at: null,
		priority: null,
		tags: [],
		created_at: "2026-01-01T00:00:00+00:00",
		updated_at: "2026-01-01T00:00:00+00:00",
		...over,
	}) as Task;

const overdue = task(1, { due_at: "2020-01-01T00:00:00Z", priority: "p1" });
const later = task(2, {
	due_at: "2999-01-01T00:00:00Z",
	priority: "p4",
	tags: [{ id: 1, name: "工作" }],
});
const plain = task(3);

describe("空条件", () => {
	it("isFilterEmpty 认得全空与任意一项有值", () => {
		expect(
			isFilterEmpty({
				status: [],
				tags: [],
				priority: [],
				dueFrom: null,
				dueTo: null,
			}),
		).toBe(true);
		expect(
			isFilterEmpty({
				status: ["active"],
				tags: [],
				priority: [],
				dueFrom: null,
				dueTo: null,
			}),
		).toBe(false);
	});

	it("空条件筛出全部（一条都不少）", () => {
		const all = [overdue, later, plain];
		expect(applyFilter(all, isFilterEmptyTestFilter())).toHaveLength(3);
	});
});

function isFilterEmptyTestFilter() {
	return {
		status: [] as TaskStatusType[],
		tags: [] as string[],
		priority: [] as TaskPriority[],
		dueFrom: null,
		dueTo: null,
	};
}

describe("matchesFilter", () => {
	it("状态命中", () => {
		const filter = {
			...isFilterEmptyTestFilter(),
			status: ["active"] as TaskStatusType[],
		};
		expect(matchesFilter(task(1, { status: "active" }), filter)).toBe(true);
		expect(matchesFilter(task(2, { status: "backlog" }), filter)).toBe(false);
	});

	it("同一条件多值是「或」", () => {
		const filter = {
			...isFilterEmptyTestFilter(),
			status: ["active", "completed"] as TaskStatusType[],
		};
		expect(matchesFilter(task(1, { status: "active" }), filter)).toBe(true);
		expect(matchesFilter(task(2, { status: "completed" }), filter)).toBe(true);
		expect(matchesFilter(task(3, { status: "backlog" }), filter)).toBe(false);
	});

	it("条件之间是「且」", () => {
		const filter = {
			...isFilterEmptyTestFilter(),
			status: ["active"] as TaskStatusType[],
			priority: ["p1"] as TaskPriority[],
		};
		expect(
			matchesFilter(task(1, { status: "active", priority: "p1" }), filter),
		).toBe(true);
		// 只中一条不算命中
		expect(
			matchesFilter(task(2, { status: "active", priority: "p2" }), filter),
		).toBe(false);
	});

	it("选了优先级，没设优先级的任务不命中（它不是 p1）", () => {
		const filter = {
			...isFilterEmptyTestFilter(),
			priority: ["p1"] as TaskPriority[],
		};
		expect(matchesFilter(plain, filter)).toBe(false);
		expect(matchesFilter(overdue, filter)).toBe(true);
	});

	it("标签多值是「任一命中」", () => {
		const filter = { ...isFilterEmptyTestFilter(), tags: ["工作", "家"] };
		expect(matchesFilter(later, filter)).toBe(true);
		expect(matchesFilter(plain, filter)).toBe(false);
	});

	it("选了截止范围，没填截止的任务不在范围内", () => {
		const filter = {
			...isFilterEmptyTestFilter(),
			dueFrom: "2020-01-01T00:00:00Z",
			dueTo: "2021-01-01T00:00:00Z",
		};
		expect(matchesFilter(overdue, filter)).toBe(true);
		expect(matchesFilter(plain, filter)).toBe(false);
		expect(matchesFilter(later, filter)).toBe(false);
	});

	it("只给一端也是范围（另一端不限）", () => {
		const onlyFrom = {
			...isFilterEmptyTestFilter(),
			dueFrom: "2020-01-01T00:00:00Z",
		};
		expect(matchesFilter(overdue, onlyFrom)).toBe(true);
		expect(matchesFilter(later, onlyFrom)).toBe(true);
		expect(matchesFilter(plain, onlyFrom)).toBe(false);
	});
});

describe("活动条件 chip", () => {
	it("每条活动条件出一条 chip（范围条件出一条）", () => {
		const chips = filterChips({
			status: ["active"],
			tags: ["工作"],
			priority: ["p1"],
			dueFrom: "2026-10-01T00:00:00Z",
			dueTo: "2026-10-31T00:00:00Z",
		});
		expect(chips).toHaveLength(4);
		expect(chips.map((c) => c.kind)).toEqual([
			"status",
			"tag",
			"priority",
			"due",
		]);
	});

	it("无条件时没有 chip", () => {
		expect(filterChips(isFilterEmptyTestFilter())).toEqual([]);
	});

	it("删一个 chip 只去掉那一条条件", () => {
		const filter = {
			status: ["active", "completed"] as TaskStatusType[],
			tags: ["工作"],
			priority: [] as TaskPriority[],
			dueFrom: null,
			dueTo: null,
		};
		const chip = filterChips(filter)[0] as FilterChip;
		const next = removeChip(filter, chip);
		expect(next.status).toEqual(["completed"]);
		expect(next.tags).toEqual(["工作"]);
	});

	it("删范围 chip 一次清掉整条范围", () => {
		const filter = {
			...isFilterEmptyTestFilter(),
			dueFrom: "2026-10-01T00:00:00Z",
			dueTo: "2026-10-31T00:00:00Z",
		};
		const chip = filterChips(filter)[0] as FilterChip;
		const next = removeChip(filter, chip);
		expect(next.dueFrom).toBeNull();
		expect(next.dueTo).toBeNull();
	});
});

describe("toggleValue", () => {
	it("再点一次取消选中", () => {
		expect(toggleValue([], "a")).toEqual(["a"]);
		expect(toggleValue(["a"], "a")).toEqual([]);
		expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
	});
});
