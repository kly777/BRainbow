import type { Task, TaskStatusType } from "@modules/task";
import { describe, expect, it } from "vitest";
import {
	bucketOfDue,
	buildChildrenMap,
	formatDue,
	groupByDue,
	groupByStatus,
} from "./task-group.ts";

/**
 * 只给关心的字段，其余走默认（Task 的必填字段较多）。
 *
 * `status` 单独放宽成 `string`：下面有两条用例**故意**传 union 之外的值，
 * 验的是"运行时不认得就丢掉 / 归默认"这条兜底 —— 那正是类型系统保证不了、
 * 只能在运行时测的部分（老库里可能存着后端已删掉的状态）。
 */
const task = (
	id: number,
	over: Partial<Omit<Task, "status">> & { status?: string } = {},
): Task =>
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
		// 库里可能有历史脏值，运行期兜底要经得起（类型上是联合类型，这里刻意越界）
		const grouped = groupByStatus([task(1, { status: "" as TaskStatusType })]);
		expect(grouped.backlog.map((t) => t.id)).toEqual([1]);
	});

	it("未知状态归 backlog（不丢弃、不新造分组）", () => {
		const grouped = groupByStatus([
			task(1, { status: "someday" as TaskStatusType }),
			task(2, { status: "active" }),
		]);
		expect(grouped.backlog.map((t) => t.id)).toEqual([1]);
		expect(
			Object.values(grouped)
				.flat()
				.map((t) => t.id),
		).toEqual([1, 2]);
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

describe("bucketOfDue：默认视图的四档", () => {
	const now = new Date(2026, 9, 3, 12, 0); // 2026-10-03 12:00 本地

	it("今天（含今天已过点）", () => {
		expect(bucketOfDue(new Date(2026, 9, 3, 15, 0).toISOString(), now)).toBe(
			"today",
		);
		expect(bucketOfDue(new Date(2026, 9, 3, 9, 0).toISOString(), now)).toBe(
			"today",
		);
	});

	it("逾期也进今天（今天就该处理它）", () => {
		expect(bucketOfDue(new Date(2026, 9, 1, 9, 0).toISOString(), now)).toBe(
			"today",
		);
	});

	it("1–7 天内 → 即将到期", () => {
		expect(bucketOfDue(new Date(2026, 9, 4, 9, 0).toISOString(), now)).toBe(
			"soon",
		);
		expect(bucketOfDue(new Date(2026, 9, 10, 12, 0).toISOString(), now)).toBe(
			"soon",
		);
	});

	it("8 天以上 → 以后", () => {
		expect(bucketOfDue(new Date(2026, 9, 20, 9, 0).toISOString(), now)).toBe(
			"later",
		);
	});

	it("无 due → 收件箱", () => {
		expect(bucketOfDue(null, now)).toBe("inbox");
		expect(bucketOfDue("不是日期", now)).toBe("inbox");
	});
});

describe("groupByDue", () => {
	it("组内保持传入顺序（顺序是服务端的事）", () => {
		const now = new Date(2026, 9, 3, 12, 0);
		const grouped = groupByDue(
			[
				task(1, { due_at: new Date(2026, 9, 3, 15, 0).toISOString() }),
				task(2, { due_at: null }),
				task(3, { due_at: new Date(2026, 9, 3, 18, 0).toISOString() }),
			],
			now,
		);
		expect(grouped.today.map((t) => t.id)).toEqual([1, 3]);
		expect(grouped.inbox.map((t) => t.id)).toEqual([2]);
	});
});

describe("formatDue", () => {
	const now = new Date(2026, 9, 3, 12, 0);

	it("今天带钟点", () => {
		expect(formatDue(new Date(2026, 9, 3, 15, 5).toISOString(), now)).toEqual({
			text: "今天 15:05",
			overdue: false,
		});
	});

	it("逾期给天数与标记", () => {
		expect(formatDue(new Date(2026, 9, 1, 12, 0).toISOString(), now)).toEqual({
			text: "逾期 2 天",
			overdue: true,
		});
	});

	it("一周内给剩余天数", () => {
		expect(formatDue(new Date(2026, 9, 5, 12, 0).toISOString(), now)).toEqual({
			text: "还剩 2 天",
			overdue: false,
		});
	});

	it("更远的给月-日", () => {
		expect(formatDue(new Date(2026, 9, 20, 9, 0).toISOString(), now)).toEqual({
			text: "10-20",
			overdue: false,
		});
	});

	it("无 due / 坏值 → null（不编一个日期出来）", () => {
		expect(formatDue(null, now)).toBeNull();
		expect(formatDue("xx", now)).toBeNull();
	});
});
