import { describe, expect, it } from "vite-plus/test";
import type { Task } from "../api.ts";
import { countScopes, dayDiff, scopeTasks, TASK_SCOPES } from "./task-scope.ts";

const NOW = new Date(2026, 9, 18, 10, 0, 0);

const task = (over: Partial<Task> = {}): Task => ({
	id: 1,
	title: "任务",
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

const list: Task[] = [
	task({ id: 1, title: "无截止" }),
	task({
		id: 2,
		title: "今天",
		due_at: new Date(2026, 9, 18, 18, 0, 0).toISOString(),
	}),
	task({
		id: 3,
		title: "逾期",
		due_at: new Date(2026, 9, 17, 18, 0, 0).toISOString(),
	}),
	task({
		id: 4,
		title: "未来",
		due_at: new Date(2026, 9, 20, 18, 0, 0).toISOString(),
	}),
	task({
		id: 5,
		title: "太远",
		due_at: new Date(2026, 9, 30, 18, 0, 0).toISOString(),
	}),
	task({ id: 6, title: "已完成", status: "completed" }),
	task({ id: 7, title: "已归档", status: "archived" }),
];

describe("task scope", () => {
	it("dayDiff 按本地日历日算，不受时刻影响", () => {
		expect(dayDiff(new Date(2026, 9, 18, 23, 59).toISOString(), NOW)).toBe(0);
		expect(dayDiff(new Date(2026, 9, 19, 0, 1).toISOString(), NOW)).toBe(1);
		expect(dayDiff(new Date(2026, 9, 17, 23, 59).toISOString(), NOW)).toBe(-1);
		expect(dayDiff(null, NOW)).toBeNull();
	});

	it("all 排除已完成与归档", () => {
		expect(scopeTasks(list, "all", NOW).map((item) => item.id)).toEqual([
			1, 2, 3, 4, 5,
		]);
	});

	it("today / upcoming / overdue 各取各的", () => {
		expect(scopeTasks(list, "today", NOW).map((item) => item.id)).toEqual([2]);
		expect(scopeTasks(list, "upcoming", NOW).map((item) => item.id)).toEqual([
			4,
		]);
		expect(scopeTasks(list, "overdue", NOW).map((item) => item.id)).toEqual([
			3,
		]);
	});

	it("completed 只看已完成", () => {
		expect(scopeTasks(list, "completed", NOW).map((item) => item.id)).toEqual([
			6,
		]);
	});

	it("countScopes 与过滤结果一致", () => {
		expect(countScopes(list, NOW)).toEqual({
			all: 5,
			today: 1,
			upcoming: 1,
			overdue: 1,
			completed: 1,
		});
	});

	it("范围表覆盖全部 key 且首页不含 completed", () => {
		expect(TASK_SCOPES.map((scope) => scope.key)).toEqual([
			"all",
			"today",
			"upcoming",
			"overdue",
			"completed",
		]);
	});
});
