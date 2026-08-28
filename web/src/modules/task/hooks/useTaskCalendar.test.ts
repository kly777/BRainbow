import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskCalendar } from "./useTaskCalendar.ts";

// 模拟依赖
vi.mock("@shared/utils", () => ({
	notifyError: vi.fn(),
	tryAsync: vi.fn(),
}));

vi.mock("@modules/task", () => ({
	getCalendarEventsE: vi.fn(),
}));

describe("useTaskCalendar", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2024, 0, 15)); // 2024年1月15日
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("管理任务日历状态", async () => {
		// 测试管理任务日历状态
		await createRoot(async (dispose) => {
			try {
				const calendar = useTaskCalendar();

				// 验证初始状态
				expect(calendar.currentDate()).toEqual(new Date(2024, 0, 15));

				// 验证月份标题
				expect(calendar.monthTitle()).toBe("2024年1月");
			} finally {
				dispose();
			}
		});
	});

	it("计算月份天数", async () => {
		// 测试计算月份天数
		await createRoot(async (dispose) => {
			try {
				const calendar = useTaskCalendar();

				// 验证2024年1月的天数
				const days = calendar.daysInMonth();
				expect(days.length).toBe(35); // 1月有31天，但需要填充到7的倍数

				// 验证第一天是周一（2024年1月1日是周一）
				expect(days[0]).toBeNull(); // 周日

				// 验证最后一天
				expect(days[34]).toBeNull(); // 填充的null
			} finally {
				dispose();
			}
		});
	});

	it("管理日历视图切换", async () => {
		// 测试管理日历视图切换
		await createRoot(async (dispose) => {
			try {
				const calendar = useTaskCalendar();

				// 切换到下个月
				calendar.changeMonth(1);

				// 验证日期更新
				expect(calendar.currentDate().getMonth()).toBe(1); // 2月
				expect(calendar.monthTitle()).toBe("2024年2月");

				// 切换到上个月
				calendar.changeMonth(-1);

				// 验证日期更新
				expect(calendar.currentDate().getMonth()).toBe(0); // 1月
				expect(calendar.monthTitle()).toBe("2024年1月");
			} finally {
				dispose();
			}
		});
	});

	it("获取特定日期的事件", async () => {
		// 测试获取特定日期的事件
		await createRoot(async (dispose) => {
			try {
				const calendar = useTaskCalendar();

				// 获取特定日期的事件
				const date = new Date(2024, 0, 15);
				const events = calendar.getEventsForDate(date);

				// 验证返回数组（可能是空数组，因为资源还没有加载）
				expect(Array.isArray(events)).toBe(true);
			} finally {
				dispose();
			}
		});
	});
});
