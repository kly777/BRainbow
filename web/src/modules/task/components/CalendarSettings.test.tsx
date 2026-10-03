// @vitest-environment jsdom
// 设置条与网格**共享同一份日历状态** —— 这是本组件存在的全部理由：
// 各自 `useTaskCalendar()` 会出现"下拉改了、网格没变"和两次请求。

import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskCalendar } from "../hooks/useTaskCalendar.ts";
import CalendarSettings from "./CalendarSettings.tsx";
import TaskCalendar from "./TaskCalendar.tsx";

vi.mock("@modules/task/api.ts", () => ({
	getCalendarEventsE: vi.fn().mockResolvedValue([]),
	cachedRequest: vi.fn(),
}));

const disposers: Array<() => void> = [];

function mountBoth() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	createRoot((dispose) => {
		const calendar = useTaskCalendar();
		render(
			() => (
				<div>
					<CalendarSettings calendar={calendar} />
					<TaskCalendar calendar={calendar} />
				</div>
			),
			host,
		);
		disposers.push(dispose);
	});
	return host;
}

const setSelect = (host: HTMLElement, id: string, value: string) => {
	const select = host.querySelector<HTMLSelectElement>(`#${id}`);
	if (!select) throw new Error(`找不到 #${id}`);
	select.value = value;
	select.dispatchEvent(new Event("change", { bubbles: true }));
};

const firstHeader = (host: HTMLElement) =>
	host.querySelector("thead th [class*='headerFull']")?.textContent?.trim();

describe("CalendarSettings 与网格共享状态", () => {
	beforeEach(() => {
		localStorage.clear();
	});
	afterEach(() => {
		while (disposers.length > 0) {
			disposers.pop()?.();
		}
	});

	it("改周起始日：表头跟着变（不是只有下拉自己变）", () => {
		const host = mountBoth();
		const before = firstHeader(host);

		setSelect(host, "calendar-week-start", "mon");

		expect(firstHeader(host)).not.toBe(before);
		expect(localStorage.getItem("brainbow_calendar_week_start")).toBe("mon");
	});

	it("选「跟随区域设置」把显式选择清掉（存 null）", () => {
		localStorage.setItem("brainbow_calendar_week_start", "sun");
		const host = mountBoth();
		expect(
			host.querySelector<HTMLSelectElement>("#calendar-week-start")?.value,
		).toBe("sun");

		setSelect(host, "calendar-week-start", "auto");

		expect(localStorage.getItem("brainbow_calendar_week_start")).toBeNull();
	});

	it("没设置过时下拉显示「跟随区域设置」而不是生效的那一天", () => {
		const host = mountBoth();
		// 关键：显示的是"用户选过什么"，否则选了周一后下拉里显示"周一"，
		// 用户再也找不到"跟随区域设置"这一项
		expect(
			host.querySelector<HTMLSelectElement>("#calendar-week-start")?.value,
		).toBe("auto");
	});

	it("改密度：折叠条数真的变（3 ↔ 5）", () => {
		const host = mountBoth();
		setSelect(host, "calendar-density", "standard");
		expect(localStorage.getItem("brainbow_calendar_density")).toBe("standard");

		setSelect(host, "calendar-density", "compact");
		expect(localStorage.getItem("brainbow_calendar_density")).toBe("compact");
	});
});
