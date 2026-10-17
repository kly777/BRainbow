// ── 条件模型的纯函数测试 ──
// 这些规则会同时喂给列表行、录入框与日历，所以按"输入 → 输出"直测，不做组件渲染。

import { describe, expect, it } from "vite-plus/test";
import type { Task } from "../api.ts";
import {
	type ConditionValues,
	formatEffort,
	formatPlan,
	hasCondition,
	missingConditions,
	planEndMinute,
	toTaskUpdates,
	validateTimeRange,
	valuesOfTask,
} from "./conditions.ts";

const NOW = new Date(2026, 9, 17, 10, 0); // 2026-10-17 10:00 本地

const values = (over: Partial<ConditionValues> = {}): ConditionValues => ({
	startAt: null,
	dueAt: null,
	priority: null,
	effortMinutes: null,
	tags: [],
	...over,
});

const iso = (y: number, m: number, d: number, h: number, min = 0) =>
	new Date(y, m - 1, d, h, min).toISOString();

describe("valuesOfTask", () => {
	it("把任务里的标签对象摊成名字数组", () => {
		const task = {
			start_at: iso(2026, 10, 18, 9),
			due_at: iso(2026, 10, 19, 18),
			priority: "p1",
			effort_estimate_minutes: 45,
			tags: [
				{ id: 1, name: "工作" },
				{ id: 2, name: "周报" },
			],
		} as unknown as Task;
		expect(valuesOfTask(task)).toEqual({
			startAt: iso(2026, 10, 18, 9),
			dueAt: iso(2026, 10, 19, 18),
			priority: "p1",
			effortMinutes: 45,
			tags: ["工作", "周报"],
		});
	});
});

describe("hasCondition / missingConditions", () => {
	it("空任务缺四个单值条件，但标签永远在菜单里（可继续加）", () => {
		expect(missingConditions(values())).toEqual([
			"start",
			"due",
			"priority",
			"effort",
			"tags",
		]);
	});

	it("已经加过的条件不再出现在菜单里；标签例外", () => {
		const missing = missingConditions(
			values({ startAt: iso(2026, 10, 18, 9), priority: "p2", tags: ["工作"] }),
		);
		expect(missing).toEqual(["due", "effort", "tags"]);
	});

	it("有值与空值的判定", () => {
		expect(hasCondition(values(), "start")).toBe(false);
		expect(
			hasCondition(values({ startAt: iso(2026, 10, 18, 9) }), "start"),
		).toBe(true);
		expect(hasCondition(values({ tags: ["a"] }), "tags")).toBe(true);
	});
});

describe("toTaskUpdates", () => {
	it("只映射出现的键，未出现的保持不动", () => {
		expect(toTaskUpdates({ priority: "p3" })).toEqual({ priority: "p3" });
	});

	it("标签名字数组换成 Tag 对象（PATCH 的整体替换语义）", () => {
		const updates = toTaskUpdates({ tags: ["工作", "家"] });
		expect(updates.tags?.map((tag) => tag.name)).toEqual(["工作", "家"]);
		expect(updates.tags?.every((tag) => tag.id < 0)).toBe(true);
	});

	it("显式清空会映射成 null，而不是被省略（双层 Option 的意义）", () => {
		expect(toTaskUpdates({ dueAt: null })).toEqual({ due_at: null });
		expect(toTaskUpdates({ effortMinutes: null })).toEqual({
			effort_estimate_minutes: null,
		});
	});
});

describe("formatPlan", () => {
	it("今天 + 时长 → 今天 14:00–15:00", () => {
		expect(formatPlan(iso(2026, 10, 17, 14), 60, NOW)).toBe(
			"计划 今天 14:00–15:00",
		);
	});

	it("明天但不给时长 → 只有开始时刻", () => {
		expect(formatPlan(iso(2026, 10, 18, 9), null, NOW)).toBe("计划 明天 09:00");
	});

	it("7 天内用星期，超过用月-日", () => {
		expect(formatPlan(iso(2026, 10, 20, 9), null, NOW)).toBe("计划 周二 09:00");
		expect(formatPlan(iso(2026, 11, 2, 9), null, NOW)).toBe("计划 11-02 09:00");
	});

	it("跨日的块不写两个星期词，直接给两端日期", () => {
		expect(formatPlan(iso(2026, 10, 17, 23), 120, NOW)).toBe(
			"计划 10-17 23:00–10-18 01:00",
		);
	});

	it("没有计划时间或坏值返回 null", () => {
		expect(formatPlan(null, 60, NOW)).toBeNull();
		expect(formatPlan("not-a-date", 60, NOW)).toBeNull();
	});
});

describe("validateTimeRange", () => {
	it("计划早于截止合法；相等也合法", () => {
		expect(
			validateTimeRange(iso(2026, 10, 17, 9), iso(2026, 10, 17, 10)),
		).toBeNull();
		expect(
			validateTimeRange(iso(2026, 10, 17, 10), iso(2026, 10, 17, 10)),
		).toBeNull();
	});

	it("计划晚于截止给出人话", () => {
		expect(
			validateTimeRange(iso(2026, 10, 17, 11), iso(2026, 10, 17, 10)),
		).toBe("计划时间不能晚于截止时间");
	});

	it("缺任一端不校验", () => {
		expect(validateTimeRange(null, iso(2026, 10, 17, 10))).toBeNull();
	});
});

describe("formatEffort", () => {
	it("分钟 / 整小时 / 小时加分钟", () => {
		expect(formatEffort(45)).toBe("45m");
		expect(formatEffort(60)).toBe("1h");
		expect(formatEffort(90)).toBe("1h30m");
	});
});

describe("planEndMinute", () => {
	it("有开始与时长才算结束", () => {
		expect(planEndMinute(iso(2026, 10, 17, 14), 60)).toBe(15 * 60);
		expect(planEndMinute(iso(2026, 10, 17, 14), null)).toBeNull();
		expect(planEndMinute(null, 60)).toBeNull();
	});
});
