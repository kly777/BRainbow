// @vitest-environment jsdom
// 日历纯计算的验收用例，逐条对着 06-日历视图 §3 的验收表（S4-a / S4-b / S4-i）

import { beforeEach, describe, expect, it } from "vitest";
import type { CalendarEvent } from "../api-types.ts";
import {
	type CalendarDensity,
	columnWeekday,
	DENSITY_COLLAPSED_COUNT,
	dayKey,
	formatDuration,
	formatSegmentTime,
	getCalendarDensity,
	getWeekStartSetting,
	hasFeasible,
	hasOverdue,
	isPaddingKey,
	localeFirstDay,
	localeWeekendDays,
	monthGrid,
	orderedWeekdayLabels,
	parseWeekParam,
	resolveFirstDay,
	segmentEventsByDay,
	setCalendarDensity,
	setWeekStartSetting,
	splitEventByDay,
	type Weekday,
} from "./calendar.ts";

/**
 * 本地时刻 → ISO 串。
 *
 * **必须这样构造**：跨日切分按**本地日**边界算（日历显示的是用户的本地日），
 * 若直接写 `Z` 结尾的 UTC 串，断言会随运行机器的时区漂移（UTC+8 上 22:00Z 是次日 06:00）。
 */
const at = (y: number, m: number, d: number, h = 0, min = 0) =>
	new Date(y, m, d, h, min).toISOString();

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
	return {
		task_id: 1,
		title: "站会",
		start: at(2026, 9, 3, 9),
		end: at(2026, 9, 3, 10),
		window_type: "planned",
		status: "active",
		priority: null,
		due_at: null,
		...over,
	};
}

describe("dayKey：补零", () => {
	it("月份与日都补零", () => {
		expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
		expect(dayKey(new Date(2026, 9, 30))).toBe("2026-10-30");
	});
});

describe("跨日切分（S4-a / S4-b）", () => {
	it("当天的事件只有一段", () => {
		const segments = splitEventByDay(event());
		expect(segments).toHaveLength(1);
		expect(segments[0].dayKey).toBe("2026-10-03");
		expect(segments[0].startMinute).toBe(9 * 60);
		expect(segments[0].endMinute).toBe(10 * 60);
		expect(segments[0].continuesFromPrev).toBe(false);
		expect(segments[0].continuesToNext).toBe(false);
	});

	it("跨两天的切成两段，中间那两天的边界是 0 与 1440", () => {
		// 10-02 22:00 → 10-04 02:00
		const segments = splitEventByDay(
			event({
				start: at(2026, 9, 2, 22),
				end: at(2026, 9, 4, 2),
			}),
		);
		expect(segments.map((s) => s.dayKey)).toEqual([
			"2026-10-02",
			"2026-10-03",
			"2026-10-04",
		]);
		expect(segments[0].startMinute).toBe(22 * 60);
		expect(segments[0].continuesToNext).toBe(true);
		expect(segments[1].continuesFromPrev).toBe(true);
		expect(segments[1].continuesToNext).toBe(true);
		expect(segments[1].startMinute).toBe(0);
		expect(segments[1].endMinute).toBe(1440);
		// 末段：它**当天那一片**从 0 点开始（几何事实），endMinute 才是真正的信息。
		// 时间前缀由 UI 按 `continuesFromPrev` 决定显不显示 —— 续接那天显示"00:00"是误导
		expect(segments[2].startMinute).toBe(0);
		expect(segments[2].endMinute).toBe(2 * 60);
		expect(segments[2].continuesFromPrev).toBe(true);
		expect(segments[2].continuesToNext).toBe(false);
	});

	it("S4-b：end 恰好落在午夜 → 那天不画（属于次日）", () => {
		const segments = splitEventByDay(
			event({
				start: at(2026, 9, 2, 9),
				end: at(2026, 9, 3, 0),
			}),
		);
		expect(segments.map((s) => s.dayKey)).toEqual(["2026-10-02"]);
		expect(segments[0].endMinute).toBe(1440);
		expect(segments[0].continuesToNext).toBe(false);
	});

	it("跨越闰日：那天真的存在，就要画（2028 年有 2 月 29 日）", () => {
		const segments = splitEventByDay(
			event({
				start: at(2028, 1, 28, 23),
				end: at(2028, 2, 1, 1),
			}),
		);
		// 2/28 23:00 → 3/1 01:00 跨了 2/28、2/29、3/1 三天
		expect(segments.map((s) => s.dayKey)).toEqual([
			"2028-02-28",
			"2028-02-29",
			"2028-03-01",
		]);
		// 中间那天是完整的一天
		expect(segments[1].startMinute).toBe(0);
		expect(segments[1].endMinute).toBe(1440);
	});

	it("零时长 / 反向不炸，画成当天一个段（宁可画错也不让事件消失）", () => {
		const zero = splitEventByDay(
			event({ start: at(2026, 9, 3, 9), end: at(2026, 9, 3, 9) }),
		);
		expect(zero).toHaveLength(1);
		expect(zero[0].endMinute).toBe(zero[0].startMinute);

		const reversed = splitEventByDay(
			event({ start: at(2026, 9, 3, 10), end: at(2026, 9, 3, 9) }),
		);
		expect(reversed).toHaveLength(1);
	});

	it("坏时间戳返回空（不抛）", () => {
		expect(splitEventByDay(event({ start: "不是日期" }))).toEqual([]);
	});

	it("segmentEventsByDay：按天归组，组内按开始时间排", () => {
		const map = segmentEventsByDay([
			event({
				task_id: 1,
				title: "晚",
				start: at(2026, 9, 3, 15),
				end: at(2026, 9, 3, 16),
			}),
			event({
				task_id: 2,
				title: "早",
				start: at(2026, 9, 3, 8),
				end: at(2026, 9, 3, 9),
			}),
			event({
				task_id: 3,
				title: "跨天",
				start: at(2026, 9, 3, 23),
				end: at(2026, 9, 4, 1),
			}),
		]);
		expect(map.get("2026-10-03")?.map((s) => s.event.title)).toEqual([
			"早",
			"晚",
			"跨天",
		]);
		expect(map.get("2026-10-04")?.map((s) => s.event.title)).toEqual(["跨天"]);
	});
});

describe("周起始日：locale + 设置 + 深链接（S4-i）", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("zh-CN → 周一在第一列", () => {
		expect(localeFirstDay("zh-CN")).toBe(1);
		expect(orderedWeekdayLabels(1)[0]).toBe("周一");
	});

	it("en-US → 周日在第一列", () => {
		expect(localeFirstDay("en-US")).toBe(0);
		expect(orderedWeekdayLabels(0)[0]).toBe("周日");
	});

	it("取不到 locale 时回落周一", () => {
		expect(localeFirstDay("这不是 locale")).toBe(1);
	});

	it("周末跟着 locale（zh-CN 是周六周日；CLDR 的顺序不保证，断言按集合比）", () => {
		expect([...localeWeekendDays("zh-CN")].sort()).toEqual([0, 6]);
		expect([...localeWeekendDays("en-US")].sort((a, b) => a - b)).toEqual([
			0, 6,
		]);
	});

	it("表头按起始日偏移取值（14 个字面量改成数据驱动）", () => {
		expect(orderedWeekdayLabels(1)).toEqual([
			"周一",
			"周二",
			"周三",
			"周四",
			"周五",
			"周六",
			"周日",
		]);
		expect(orderedWeekdayLabels(1, false)[0]).toBe("一");
		expect(orderedWeekdayLabels(0, false)).toEqual([
			"日",
			"一",
			"二",
			"三",
			"四",
			"五",
			"六",
		]);
	});

	it("columnWeekday 把网格列映回 getDay 编号", () => {
		expect(columnWeekday(1, 0)).toBe(1); // 周一列
		expect(columnWeekday(1, 5)).toBe(6); // 第 6 列是周六
		expect(columnWeekday(1, 6)).toBe(0); // 第 7 列是周日
	});

	it("设置项优先于 locale", () => {
		setWeekStartSetting(0); // 用户显式选周日
		expect(getWeekStartSetting()).toBe(0);
		expect(resolveFirstDay()).toBe(0);
	});

	it("深链接 ?week= 覆盖设置项", () => {
		setWeekStartSetting(0);
		expect(resolveFirstDay("mon")).toBe(1);
		expect(resolveFirstDay("sun")).toBe(0);
		// 无法识别的参数当没给
		expect(resolveFirstDay("乱写")).toBe(0);
		expect(parseWeekParam(null)).toBeNull();
	});

	it("没设置过 → null（跟 locale 走）", () => {
		expect(getWeekStartSetting()).toBeNull();
	});

	it("设置项可以清回 null", () => {
		setWeekStartSetting(3);
		setWeekStartSetting(null);
		expect(getWeekStartSetting()).toBeNull();
	});

	it("坏值从 localStorage 里被忽略", () => {
		localStorage.setItem("brainbow_calendar_week_start", "乱写");
		expect(getWeekStartSetting()).toBeNull();
	});
});

describe("密度档（S4-c2 / S4-l）", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("默认紧凑（3 条），标准 5 条", () => {
		expect(getCalendarDensity()).toBe("compact");
		expect(DENSITY_COLLAPSED_COUNT).toEqual({ compact: 3, standard: 5 });
	});

	it("切换真的改变条数", () => {
		setCalendarDensity("standard");
		expect(getCalendarDensity()).toBe("standard");
		expect(DENSITY_COLLAPSED_COUNT[getCalendarDensity()]).toBe(5);
	});

	it("坏值回落紧凑", () => {
		localStorage.setItem("brainbow_calendar_density", "乱写");
		expect(getCalendarDensity()).toBe("compact");
	});

	it("只有这两档（写出去的挡一下乱值）", () => {
		const density: CalendarDensity[] = ["compact", "standard"];
		expect(density).toHaveLength(2);
	});
});

describe("monthGrid", () => {
	it("周一开头时，2026-10-01（周四）前面补 3 格", () => {
		const cells = monthGrid(2026, 9, 1);
		expect(cells.slice(0, 3).every((cell) => cell.date === null)).toBe(true);
		expect(dayKey(cells[3].date as Date)).toBe("2026-10-01");
	});

	it("周日开头时补 4 格", () => {
		const cells = monthGrid(2026, 9, 0);
		expect(cells.slice(0, 4).every((cell) => cell.date === null)).toBe(true);
		expect(dayKey(cells[4].date as Date)).toBe("2026-10-01");
	});

	it("总格数是 7 的倍数（补位格可聚焦，焦点顺序要与视觉一致）", () => {
		for (const firstDay of [0, 1] as Weekday[]) {
			for (const month of [0, 1, 8, 9]) {
				expect(monthGrid(2026, month, firstDay).length % 7).toBe(0);
			}
		}
	});

	it("补位格的 key 可识别且不与日期 key 混淆", () => {
		const cells = monthGrid(2026, 9, 1);
		expect(isPaddingKey(cells[0].key)).toBe(true);
		expect(isPaddingKey(cells[3].key)).toBe(false);
	});
});

describe("日期数字的徽标判定", () => {
	it("有未完成的逾期任务 → ⚠", () => {
		expect(hasOverdue([event({ due_at: "2020-01-01T00:00:00Z" })])).toBe(true);
	});

	it("已完成 / 已归档的逾期不算债", () => {
		expect(
			hasOverdue([
				event({ due_at: "2020-01-01T00:00:00Z", status: "completed" }),
			]),
		).toBe(false);
		expect(
			hasOverdue([
				event({ due_at: "2020-01-01T00:00:00Z", status: "archived" }),
			]),
		).toBe(false);
	});

	it("没到期或没有 due → 不标", () => {
		expect(hasOverdue([event({ due_at: null })])).toBe(false);
		expect(hasOverdue([event({ due_at: "2999-01-01T00:00:00Z" })])).toBe(false);
	});

	it("S4-f：feasible 只画存在性徽标，不当安排", () => {
		expect(hasFeasible([event({ window_type: "feasible" })])).toBe(true);
		expect(hasFeasible([event({ window_type: "planned" })])).toBe(false);
	});
});

describe("文案", () => {
	it("时间前缀补零；续接那天由 continuesFromPrev 决定显不显示", () => {
		const [first, second] = splitEventByDay(
			event({
				start: at(2026, 9, 2, 22, 30),
				end: at(2026, 9, 3, 3),
			}),
		);
		expect(formatSegmentTime(first)).toBe("22:30");
		// 续接段的时间前缀是那天的 0 点 —— UI 见 continuesFromPrev=true 时不该显示它
		expect(formatSegmentTime(second)).toBe("00:00");
		expect(second.continuesFromPrev).toBe(true);
	});

	it("时长：45 分钟 / 1 小时 / 1 小时 30 分", () => {
		expect(formatDuration(45)).toBe("45 分钟");
		expect(formatDuration(60)).toBe("1 小时");
		expect(formatDuration(90)).toBe("1 小时 30 分");
	});
});
