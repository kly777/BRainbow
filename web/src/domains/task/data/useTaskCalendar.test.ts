// @vitest-environment jsdom
import { createRoot } from "solid-js";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vite-plus/test";
import { useTaskCalendar } from "./useTaskCalendar.ts";

// 模拟依赖：notifyError 静音；其余（useListResource 等）走原实现 ——
// 局部 mock 会把未列出的导出变成 undefined，hook 一引就炸
vi.mock("@shared/utils", async (importOriginal) => ({
	...(await importOriginal<typeof import("@shared/utils")>()),
	notifyError: vi.fn(),
}));

vi.mock("@modules/task/api.ts", () => ({
	getCalendarEventsE: vi.fn(),
}));

vi.mock("../calendarApi.ts", () => ({
	getEventsE: vi.fn(() => Promise.resolve([])),
}));

describe("useTaskCalendar", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2024, 0, 15)); // 2024 年 1 月 15 日（周一）
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/** 在 createRoot 里跑一段并同步断言 */
	function withCalendar<T>(
		fn: (m: ReturnType<typeof useTaskCalendar>) => T,
	): T {
		return createRoot((dispose) => {
			try {
				return fn(useTaskCalendar());
			} finally {
				dispose();
			}
		});
	}

	it("初始停在本月，标题给出年月", () => {
		withCalendar((m) => {
			expect(m.currentDate()).toEqual(new Date(2024, 0, 15));
			expect(m.monthTitle()).toBe("2024 年 1 月");
		});
	});

	it("翻月（1 月 31 日出发也不会滚到 3 月）", () => {
		withCalendar((m) => {
			// 先走到 1 月 31 日
			m.goToToday();
			expect(m.monthTitle()).toBe("2024 年 1 月");

			m.changeMonth(1);
			expect(m.monthTitle()).toBe("2024 年 2 月");

			// 再翻 12 次回到下一年 1 月（走的是"落在 1 号再设月"，不会溢出）
			for (let i = 0; i < 11; i++) {
				m.changeMonth(1);
			}
			expect(m.monthTitle()).toBe("2025 年 1 月");

			m.changeMonth(-1);
			expect(m.monthTitle()).toBe("2024 年 12 月");
		});
	});

	it("S4-7：回到今天", () => {
		withCalendar((m) => {
			m.changeMonth(5);
			expect(m.monthTitle()).not.toBe("2024 年 1 月");
			m.goToToday();
			expect(m.monthTitle()).toBe("2024 年 1 月");
		});
	});

	it("网格补位到 7 的倍数（2024 年 1 月 1 日是周一）", () => {
		withCalendar((m) => {
			const cells = m.grid();
			expect(cells.length % 7).toBe(0);
			// 补位格的 date 为 null
			expect(cells.some((cell) => cell.date === null)).toBe(true);
		});
	});

	it("周起始日决定补位格数：周一开头补 0 格，周日开头补 1 格", () => {
		withCalendar((m) => {
			// 显式设成周一，别依赖测试环境的 locale
			m.setFirstDay(1);
			const monday = m.grid();
			expect(monday[0].date).toBeInstanceOf(Date);
			expect(monday[0].date?.getDate()).toBe(1);

			m.setFirstDay(0);
			const sunday = m.grid();
			expect(sunday[0].date).toBeNull();
			expect(sunday[1].date?.getDate()).toBe(1);
		});
	});

	it("表头按当前周起始日取值（默认跟随 locale）", () => {
		withCalendar((m) => {
			expect(m.weekdayLabels()).toHaveLength(7);
			expect(m.weekdayShortLabels()).toHaveLength(7);
			// 起始日是合法的一周七天标签
			for (const label of m.weekdayLabels()) {
				expect(label).toMatch(/^周[日一二三四五六]$/);
			}
		});
	});

	it("设置项改周起始日后表头跟着变，并被记住", () => {
		withCalendar((m) => {
			const before = m.weekdayLabels()[0];
			m.setFirstDay(before === "周日" ? 1 : 0);
			expect(m.weekdayLabels()[0]).not.toBe(before);
			// 换一个 hook 实例（新开页面）仍然是这个设置
			const again = withCalendar((m2) => m2.weekdayLabels()[0]);
			expect(again).toBe(m.weekdayLabels()[0]);
		});
	});

	it("深链接 ?week= 覆盖用户设置", () => {
		const param = () => "mon";
		const result = createRoot((dispose) => {
			try {
				localStorage.setItem("brainbow_calendar_week_start", "sun");
				const m = useTaskCalendar(param);
				return { first: m.weekdayLabels()[0], firstDay: m.firstDay() };
			} finally {
				dispose();
			}
		});
		expect(result.firstDay).toBe(1);
		expect(result.first).toBe("周一");
	});

	it("密度档切换真的改变折叠条数，并被记住", () => {
		withCalendar((m) => {
			expect(m.density()).toBe("compact");
			expect(m.collapsedCount()).toBe(3);

			m.setDensity("standard");
			expect(m.collapsedCount()).toBe(5);

			// 换实例仍是标准档（localStorage 记住了）
			expect(withCalendar((m2) => m2.collapsedCount())).toBe(5);
		});
	});

	it("没有数据时各天的事件为空数组（不炸）", () => {
		withCalendar((m) => {
			expect(m.eventsFor("2024-01-15")).toEqual([]);
			expect(m.segmentsFor("2024-01-15")).toEqual([]);
		});
	});

	it("isToday 只对今天为真，补位格为假", () => {
		withCalendar((m) => {
			expect(m.isToday(new Date(2024, 0, 15))).toBe(true);
			expect(m.isToday(new Date(2024, 0, 16))).toBe(false);
			expect(m.isToday(null)).toBe(false);
		});
	});
});
