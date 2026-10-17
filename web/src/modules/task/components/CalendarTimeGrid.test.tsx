// @vitest-environment jsdom
// 周/日时间轴的渲染验收（S5-a / S5-b / S5-c / S5-f / S5-g）。
// 像素与布局的算法在 lib/calendarAxis.test.ts，这里只测渲染契约。

import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vite-plus/test";
import type { CalendarEvent } from "../api-types.ts";
import { useTaskCalendar } from "../hooks/useTaskCalendar.ts";
import CalendarTimeGrid from "./CalendarTimeGrid.tsx";

const getCalendarEventsE = vi.fn();
const getEventsE = vi.fn();
vi.mock("@modules/task/api.ts", () => ({
	getCalendarEventsE: (...args: unknown[]) => getCalendarEventsE(...args),
	cachedRequest: vi.fn(),
}));
vi.mock("../calendarApi.ts", () => ({
	getEventsE: (...args: unknown[]) => getEventsE(...args),
}));

const disposers: Array<() => void> = [];

/** 本地时刻构造（跨日切分按本地日算，用 UTC 串会随机器时区漂移） */
const at = (y: number, m: number, d: number, h: number, min = 0) =>
	new Date(y, m, d, h, min).toISOString();

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
	return {
		task_id: 1,
		window_id: 101,
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

function mount(onSchedule?: (move: unknown) => void) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	createRoot((dispose) => {
		const calendar = useTaskCalendar();
		calendar.setGranularity("week");
		render(
			() => <CalendarTimeGrid calendar={calendar} onSchedule={onSchedule} />,
			host,
		);
		disposers.push(dispose);
	});
	return host;
}

/** 带落位回调的挂载（键盘路径的测试要用） */
const mountWithSchedule = (moves: unknown[]) =>
	mount((move) => moves.push(move));

async function flush() {
	await vi.advanceTimersByTimeAsync(1);
	await Promise.resolve();
}

/**
 * 事件块是 `div[role=button]` 而不是 `<button>`（块内要嵌改时间的 input，
 * HTML 禁止 button 含交互内容），所以按 class 找而不是按标签名。
 */
const blocksOf = (host: HTMLElement) => [
	...host.querySelectorAll<HTMLElement>('[class*="eventBlock"]'),
];

const blockByTitle = (host: HTMLElement, title: string) =>
	blocksOf(host).find((b) => b.textContent?.includes(title));

describe("CalendarTimeGrid", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2024, 0, 15, 9, 0)); // 周一 09:00
		getCalendarEventsE.mockResolvedValue([]);
		getEventsE.mockResolvedValue([]);
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

		const heightOf = (title: string) =>
			Number.parseFloat(blockByTitle(host, title)?.style.height ?? "0");
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
		const styleOf = (title: string, prop: "width" | "left") =>
			Number.parseFloat(blockByTitle(host, title)?.style[prop] ?? "0");

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

		const labels = blocksOf(host).map((b) => b.textContent);
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

describe("CalendarTimeGrid：键盘与焦点（S5-j / S5-f / S5-13）", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2024, 0, 15, 9, 0));
		getCalendarEventsE.mockResolvedValue([]);
	});
	afterEach(() => {
		while (disposers.length > 0) {
			disposers.pop()?.();
		}
		vi.useRealTimers();
	});

	it("S5-j：整个时间轴只占一个 Tab 停靠点（roving tabindex）", async () => {
		getCalendarEventsE.mockResolvedValue([
			event({ task_id: 1, window_id: 101, title: "A" }),
			event({
				task_id: 2,
				window_id: 102,
				title: "B",
				start: at(2024, 0, 15, 11),
				end: at(2024, 0, 15, 12),
			}),
			event({
				task_id: 3,
				window_id: 103,
				title: "C",
				start: at(2024, 0, 15, 14),
				end: at(2024, 0, 15, 15),
			}),
		]);
		const host = mount();
		await flush();

		const focusable = blocksOf(host).filter(
			(b) => b.getAttribute("tabindex") === "0",
		);
		expect(focusable.length).toBeLessThanOrEqual(1);
		// 其余的必须是 -1（可被脚本聚焦、但 Tab 走不到）
		for (const block of blocksOf(host)) {
			expect(["0", "-1"]).toContain(block.getAttribute("tabindex"));
		}
	});

	it("S5-f：↑/↓ 是改时间，←/→ 是事件间移动焦点", async () => {
		getCalendarEventsE.mockResolvedValue([
			event({ task_id: 1, window_id: 101, title: "A" }),
			event({
				task_id: 2,
				window_id: 102,
				title: "B",
				start: at(2024, 0, 15, 11),
				end: at(2024, 0, 15, 12),
			}),
		]);
		const moves: unknown[] = [];
		const host = mountWithSchedule(moves);
		await flush();

		const a = blockByTitle(host, "A");
		expect(a).toBeTruthy();

		// ↑↓ 不冒泡成"移动焦点"，而是发一次落位（上移一格 = 15 分钟）
		a?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
		);
		expect(moves).toHaveLength(1);
		expect(moves[0]).toMatchObject({
			windowId: 101,
			startMinute: 8 * 60 + 45, // 09:00 - 15 分钟
		});

		// ←/→ 不发落位，只移动焦点
		moves.length = 0;
		a?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
		);
		expect(moves).toHaveLength(0);
	});

	it("事件块带完整的可访问名（不是只有标题）", async () => {
		getCalendarEventsE.mockResolvedValue([event()]);
		const host = mount();
		await flush();
		expect(blockByTitle(host, "站会")?.getAttribute("aria-label")).toBe(
			"站会 09:00 到 10:00",
		);
	});
});
