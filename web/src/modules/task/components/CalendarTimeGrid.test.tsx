// @vitest-environment jsdom
// 周/日时间轴的渲染验收（S5-a / S5-b / S5-c / S5-f / S5-g）。
// 像素与布局的算法在 lib/calendarAxis.test.ts，这里只测渲染契约。

import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../api-types.ts";
import { useTaskCalendar } from "../hooks/useTaskCalendar.ts";
import CalendarTimeGrid from "./CalendarTimeGrid.tsx";

const getCalendarEventsE = vi.fn();
vi.mock("@modules/task/api.ts", () => ({
	getCalendarEventsE: (...args: unknown[]) => getCalendarEventsE(...args),
	cachedRequest: vi.fn(),
}));

const disposers: Array<() => void> = [];

/** 本地时刻构造（跨日切分按本地日算，用 UTC 串会随机器时区漂移） */
const at = (y: number, m: number, d: number, h: number, min = 0) =>
	new Date(y, m, d, h, min).toISOString();

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
	return {
		task_id: 1,
		title: "站会",
		start: at(2024, 0, 15, 9),
		end: at(2024, 0, 15, 10),
		window_type: "planned",
		status: "active",
		priority: null,
		due_at: null,
		...over,
	};
}

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	createRoot((dispose) => {
		const calendar = useTaskCalendar();
		calendar.setGranularity("week");
		render(() => <CalendarTimeGrid calendar={calendar} />, host);
		disposers.push(dispose);
	});
	return host;
}

async function flush() {
	await vi.advanceTimersByTimeAsync(1);
	await Promise.resolve();
}

describe("CalendarTimeGrid", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2024, 0, 15, 9, 0)); // 周一 09:00
		getCalendarEventsE.mockResolvedValue([]);
	});
	afterEach(() => {
		while (disposers.length > 0) {
			disposers.pop()?.();
		}
		vi.useRealTimers();
	});

	it("周视图是 7 列（当前粒度决定列数）", async () => {
		const host = mount();
		await flush();
		// 注意选择器：不能用 `[class*="dayColumn"]`，它也会命中容器 `dayColumns`
		expect(
			host.querySelectorAll('[class*="dayColumns"] > [class*="dayColumn"]'),
		).toHaveLength(7);
	});

	it("S5-b：块高度 ∝ 时长，且不低于 24px", async () => {
		getCalendarEventsE.mockResolvedValue([
			event({
				task_id: 1,
				title: "一小时",
				start: at(2024, 0, 15, 9),
				end: at(2024, 0, 15, 10),
			}),
			event({
				task_id: 2,
				title: "两小时",
				start: at(2024, 0, 15, 11),
				end: at(2024, 0, 15, 13),
			}),
			event({
				task_id: 3,
				title: "五分钟",
				start: at(2024, 0, 15, 14),
				end: at(2024, 0, 15, 14, 5),
			}),
		]);
		const host = mount();
		await flush();

		const heightOf = (title: string) => {
			const el = [...host.querySelectorAll("button")].find((b) =>
				b.textContent?.includes(title),
			);
			return Number.parseFloat(el?.style.height ?? "0");
		};
		expect(heightOf("两小时")).toBeCloseTo(heightOf("一小时") * 2, 0);
		// 5 分钟在 48px/小时 下只有 4px，被 24px 下限托住
		expect(heightOf("五分钟")).toBe(24);
	});

	it("S5-c：3 个重叠事件并排，各占三分之一", async () => {
		getCalendarEventsE.mockResolvedValue([
			event({
				task_id: 1,
				title: "A",
				start: at(2024, 0, 15, 9),
				end: at(2024, 0, 15, 11),
			}),
			event({
				task_id: 2,
				title: "B",
				start: at(2024, 0, 15, 9, 30),
				end: at(2024, 0, 15, 11, 30),
			}),
			event({
				task_id: 3,
				title: "C",
				start: at(2024, 0, 15, 10),
				end: at(2024, 0, 15, 12),
			}),
		]);
		const host = mount();
		await flush();

		// CSS 的百分比带一串小数，按数值比而不是按字符串比
		const styleOf = (title: string, prop: "width" | "left") => {
			const el = [...host.querySelectorAll("button")].find((b) =>
				b.textContent?.includes(title),
			);
			return Number.parseFloat(el?.style[prop] ?? "0");
		};

		for (const title of ["A", "B", "C"]) {
			expect(styleOf(title, "width")).toBeCloseTo(100 / 3, 3);
		}
		// 三列的左边距各不相同（0 / 33.3% / 66.7%）
		const lefts = ["A", "B", "C"].map((t) => styleOf(t, "left"));
		expect(new Set(lefts).size).toBe(3);
		expect(Math.min(...lefts)).toBeCloseTo(0, 3);
	});

	it("S5-f：feasible 不画成安排（它只是元信息）", async () => {
		getCalendarEventsE.mockResolvedValue([
			event({ task_id: 1, title: "可行块", window_type: "feasible" }),
			event({ task_id: 2, title: "计划块" }),
		]);
		const host = mount();
		await flush();

		const labels = [...host.querySelectorAll("button")].map(
			(b) => b.textContent,
		);
		expect(labels.some((l) => l?.includes("可行块"))).toBe(false);
		expect(labels.some((l) => l?.includes("计划块"))).toBe(true);
	});

	it("S5-3：跨日事件进全天行", async () => {
		getCalendarEventsE.mockResolvedValue([
			event({
				task_id: 1,
				title: "出差",
				start: at(2024, 0, 15, 22),
				end: at(2024, 0, 17, 2),
			}),
		]);
		const host = mount();
		await flush();

		const allDay = host.querySelector('[aria-label="跨日事件"]');
		expect(allDay?.textContent).toContain("出差");
	});

	it("没有跨日事件时不占全天行的位置", async () => {
		getCalendarEventsE.mockResolvedValue([event()]);
		const host = mount();
		await flush();
		expect(host.querySelector('[aria-label="跨日事件"]')).toBeNull();
	});

	it("S5-a：打开就滚到当前时刻（或工作时段起点，取较早者）", async () => {
		getCalendarEventsE.mockResolvedValue([event()]);
		const host = mount();
		await flush();

		const scroller = host.querySelector<HTMLElement>('[role="grid"]');
		// 现在是 09:00，与工作时段起点同刻 → 滚到 9*48 = 432px
		expect(scroller?.scrollTop).toBe(9 * 48);
	});

	it("S5-a：当前早于工作时段起点时滚到当前时刻", async () => {
		vi.setSystemTime(new Date(2024, 0, 15, 7, 0));
		getCalendarEventsE.mockResolvedValue([event()]);
		const host = mount();
		await flush();

		const scroller = host.querySelector<HTMLElement>('[role="grid"]');
		expect(scroller?.scrollTop).toBe(7 * 48);
	});

	it("当前时间线只画在今天那一列", async () => {
		getCalendarEventsE.mockResolvedValue([event()]);
		const host = mount();
		await flush();

		// 时间线是唯一带这个 class 的元素，出现次数 = 1（今天是周一 = 第一列）
		expect(host.querySelectorAll('[class*="nowLine"]').length).toBe(1);
	});
});
