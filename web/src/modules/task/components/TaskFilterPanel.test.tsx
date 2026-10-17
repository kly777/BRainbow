// @vitest-environment jsdom
// 筛选面板的交互契约：选中条件 → 条件进 chip → 单个 chip 能删 → 清空全部。

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";
import { EMPTY_FILTER, type TaskFilter } from "../lib/task-filter.ts";
import TaskFilterPanel, { ActiveFilterChips } from "./TaskFilterPanel.tsx";

vi.mock("@modules/task/api.ts", () => ({
	getTagsE: vi.fn().mockResolvedValue([]),
	cachedRequest: vi.fn(),
}));

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	const [filter, setFilter] = createSignal<TaskFilter>(EMPTY_FILTER);
	render(
		() => (
			<div>
				<TaskFilterPanel filter={filter()} onChange={setFilter} />
				<ActiveFilterChips filter={filter()} onChange={setFilter} />
			</div>
		),
		host,
	);
	return { host, filter };
}

/** 按可见文案找按钮 —— CSS Module 的类名在测试里带 hash，靠类名找不可靠 */
const buttonByText = (host: HTMLElement, text: string) =>
	[...host.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === text,
	);

describe("TaskFilterPanel", () => {
	it("点条件 chip 进筛选状态，并出现在活动条件区", () => {
		const { host, filter } = mount();

		// 面板常驻在工具条下方（不是模态），条件 chip 直接点
		buttonByText(host, "进行中")?.click();

		expect(filter().status).toEqual(["active"]);
		// 活动条件 chip 常驻可见（不是只在面板里）
		expect(host.textContent).toContain("状态：进行中");
	});

	it("再点一次取消该条件（aria-pressed 跟着变）", () => {
		const { host, filter } = mount();
		const chip = () => buttonByText(host, "已完成");

		chip()?.click();
		expect(filter().status).toEqual(["completed"]);
		expect(chip()?.getAttribute("aria-pressed")).toBe("true");

		chip()?.click();
		expect(filter().status).toEqual([]);
		expect(chip()?.getAttribute("aria-pressed")).toBe("false");
	});

	it("多个状态是「或」——chip 都选中着", () => {
		const { host, filter } = mount();
		buttonByText(host, "进行中")?.click();
		buttonByText(host, "已完成")?.click();
		expect(filter().status).toEqual(["active", "completed"]);
	});

	it("删单个 chip 只去掉那一条", () => {
		const { host, filter } = mount();
		buttonByText(host, "进行中")?.click();
		buttonByText(host, "已完成")?.click();

		// 活动条件区里点 × 删第一条
		const remove = host.querySelector<HTMLButtonElement>(
			'[aria-label="移除筛选条件 状态：进行中"]',
		);
		remove?.click();

		expect(filter().status).toEqual(["completed"]);
	});

	it("「清空全部」把条件一次清干净（且只在有条件时才出现）", () => {
		const { host, filter } = mount();
		expect(host.textContent).toContain("无筛选条件");

		buttonByText(host, "进行中")?.click();
		buttonByText(host, "p1")?.click();
		expect(filter().status.length + filter().priority.length).toBe(2);

		buttonByText(host, "清空全部")?.click();
		expect(filter()).toEqual(EMPTY_FILTER);
	});

	it("截止范围进 chip 时把两个端点都写出来", () => {
		const { host, filter } = mount();
		const dates = host.querySelectorAll<HTMLInputElement>('input[type="date"]');
		dates[0].value = "2026-10-01";
		dates[0].dispatchEvent(new Event("input", { bubbles: true }));
		dates[1].value = "2026-10-31";
		dates[1].dispatchEvent(new Event("input", { bubbles: true }));

		expect(filter().dueFrom).not.toBeNull();
		expect(filter().dueTo).not.toBeNull();
		expect(host.textContent).toContain("截止：2026-10-01 ~ 2026-10-31");
	});
});
