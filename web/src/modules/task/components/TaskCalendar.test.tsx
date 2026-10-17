// @vitest-environment jsdom
// 月网格的渲染验收（对着 06-日历视图 §3 与实现路线的 S4 验收表）。
// 这里只测**渲染契约**（三通道的 class、徽标、折叠数、a11y 结构）；
// 跨日切分与周起始日的算法在 lib/calendar.test.ts。

import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../api-types.ts";
import { useTaskCalendar } from "../hooks/useTaskCalendar.ts";
import TaskCalendar from "./TaskCalendar.tsx";

const getCalendarEventsE = vi.fn();
const getEventsE = vi.fn();
vi.mock("@modules/task/api.ts", () => ({
	getCalendarEventsE: (...args: unknown[]) => getCalendarEventsE(...args),
	cachedRequest: vi.fn(),
}));
vi.mock("../calendarApi.ts", () => ({
	getEventsE: (...args: unknown[]) => getEventsE(...args),
}));

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
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

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	// 日历状态由调用方持有（TaskPanel 建一份传下来），测试里用 createRoot 建一个
	const dispose = createRoot((disposeFn) => {
		const calendar = useTaskCalendar();
		render(() => <TaskCalendar calendar={calendar} />, host);
		return disposeFn;
	});
	calendars.push(dispose);
	return host;
}

/** 每次 mount 一个 root；afterEach 统一收掉（否则 jsdom 里跨用例泄漏） */
const calendars: Array<() => void> = [];

/**
 * 等 resource 把数据取回来并渲染。
 *
 * 用 `advanceTimersByTimeAsync` 而不是 `setTimeout` —— 本文件用假定时器把"今天"
 * 钉在 2024-01-15，真定时器不会自己走。
 */
async function flush() {
	await vi.advanceTimersByTimeAsync(1);
	await Promise.resolve();
}

describe("TaskCalendar：结构与 a11y（S4-j）", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2024, 0, 15));
		getCalendarEventsE.mockResolvedValue([]);
		getEventsE.mockResolvedValue([]);
	});
	afterEach(() => {
		while (calendars.length > 0) {
			calendars.pop()?.();
		}
		vi.useRealTimers();
	});

	it("是 role=grid 的表格，表头是真 th", () => {
		const host = mount();
		const grid = host.querySelector('[role="grid"]');
		expect(grid?.tagName).toBe("TABLE");
		expect(grid?.querySelectorAll("thead th")).toHaveLength(7);
		expect(grid?.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
	});

	it("S4-j：整个网格只占一个 Tab 停靠点（roving tabindex）", () => {
		const host = mount();
		const cells = host.querySelectorAll<HTMLElement>("tbody td");
		expect(cells.length).toBeGreaterThan(28);
		const focusable = [...cells].filter(
			(cell) => cell.getAttribute("tabindex") === "0",
		);
		expect(focusable).toHaveLength(1);
	});

	it("补位格可聚焦但标成 disabled（APG）", () => {
		const host = mount();
		const padding = [...host.querySelectorAll<HTMLElement>("tbody td")].filter(
			(cell) => cell.getAttribute("aria-disabled") === "true",
		);
		// 2024 年 1 月 1 日是周一，周日开头时首格是补位格
		expect(padding.length).toBeGreaterThan(0);
		// 可聚焦：tabindex 至少不是 -1 之外的值（roving 会给到其中一个 0）
		for (const cell of padding) {
			expect(["0", "-1"]).toContain(cell.getAttribute("tabindex"));
		}
	});

	it("日期格的 aria-label 念得出完整日期（不是只有'3'）", () => {
		const host = mount();
		const labels = [...host.querySelectorAll("tbody td")]
			.map((cell) => cell.getAttribute("aria-label") ?? "")
			.filter((label) => !label.includes("补位"));
		expect(labels).toContain("1月15日 周一");
	});

	it("S4-7：有「回到今天」按钮", () => {
		const host = mount();
		expect(host.textContent).toContain("今天");
	});

	it("S4-i：周起始日按 locale 推导（默认周日 → 表头第一格是周日）", () => {
		// 表头同时渲染全称与简写（窄屏切换用），所以取全称那个 span
		const firstHeader = (host: HTMLElement) =>
			host.querySelector("thead th [class*='headerFull']")?.textContent?.trim();

		// 测试环境是 en-US（周日开头）
		expect(firstHeader(mount())).toBe("周日");

		localStorage.setItem("brainbow_calendar_week_start", "mon");
		expect(firstHeader(mount())).toBe("周一");
	});
});

describe("TaskCalendar：事件条与徽标", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2024, 0, 15));
	});
	afterEach(() => {
		while (calendars.length > 0) {
			calendars.pop()?.();
		}
		vi.useRealTimers();
	});

	it("事件条带时间前缀与标题", async () => {
		getCalendarEventsE.mockResolvedValue([
			event({ title: "写周报", start: at(2024, 0, 15, 14, 30) }),
		]);
		const host = mount();
		await flush();
		const bar = host.querySelector('[title*="写周报"]');
		expect(bar?.textContent).toContain("14:30");
		expect(bar?.textContent).toContain("写周报");
	});

	it("S4-a：跨日事件在每一天都出现一条，且带断口标记", async () => {
		getCalendarEventsE.mockResolvedValue([
			event({
				title: "出差",
				start: at(2024, 0, 15, 22),
				end: at(2024, 0, 17, 2),
			}),
		]);
		const host = mount();
		await flush();
		const bars = [...host.querySelectorAll("button")].filter((b) =>
			b.textContent?.includes("出差"),
		);
		expect(bars).toHaveLength(3);
		// 断口：中间那天左右都有
		expect(bars[1].className).toMatch(/continues/);
	});

	it("S4-l：密度档决定折叠条数（紧凑 3 / 标准 5）", async () => {
		const many = Array.from({ length: 8 }, (_, i) =>
			event({
				task_id: i + 1,
				title: `会 ${i + 1}`,
				start: at(2024, 0, 15, i + 8),
			}),
		);
		getCalendarEventsE.mockResolvedValue(many);

		const compact = mount();
		await flush();
		expect(
			[...compact.querySelectorAll("button")].filter((b) =>
				b.textContent?.includes("会 "),
			).length,
		).toBe(3);
		expect(compact.textContent).toContain("更多");

		localStorage.setItem("brainbow_calendar_density", "standard");
		const standard = mount();
		await flush();
		expect(
			[...standard.querySelectorAll("button")].filter((b) =>
				b.textContent?.includes("会 "),
			).length,
		).toBe(5);
	});

	it("S4-d：逾期只出 ⚠ 图标，不给整格铺红", async () => {
		getCalendarEventsE.mockResolvedValue([event({ due_at: at(2020, 0, 1) })]);
		const host = mount();
		await flush();
		expect(host.querySelector('[title="这天有逾期未完成"]')).not.toBeNull();
		// 逾期徽标不是"一格变红"：格子上没有 danger 类
		expect(host.querySelector('[class*="danger"]')).toBeNull();
	});

	it("S4-f：feasible 只出存在性徽标", async () => {
		getCalendarEventsE.mockResolvedValue([event({ window_type: "feasible" })]);
		const host = mount();
		await flush();
		expect(host.querySelector('[title*="还不是安排"]')).not.toBeNull();
	});

	it("S4-c：三通道各有承载（边框=类型 / 底色=状态 / 角标=优先级）", async () => {
		getCalendarEventsE.mockResolvedValue([
			event({
				window_type: "feasible",
				status: "completed",
				priority: "p1",
			}),
		]);
		const host = mount();
		await flush();
		const bar = [...host.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("站会"),
		);
		const cls = bar?.className ?? "";
		// 通道 1：边框样式（dashed = feasible）
		expect(cls).toMatch(/typeFeasible/);
		// 通道 2：状态底色
		expect(cls).toMatch(/statusCompleted/);
		// 通道 3：优先级角标（abbr + title，形状而非纯颜色）
		expect(bar?.querySelector("abbr")?.textContent).toBe("▪");
	});
});
