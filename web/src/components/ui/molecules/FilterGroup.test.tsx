// ── FilterGroup 分段控件契约测试 ──
// 该组件有 7 个调用点（file / task / ontology / mem / conv / rainbow）。迁移到 <Button>
// 后最容易漏的是"选中态丢失"（少传 variant），所以这里断言行为与系统变体的一致性，
// 而不是某个哈希后的类名。

import Button from "@components/ui/atoms/Button.tsx";
import FilterGroup from "@components/ui/molecules/FilterGroup.tsx";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

function mount(node: () => JSX.Element): HTMLDivElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	return host;
}

const OPTIONS = [
	{ value: "list", label: "列表" },
	{ value: "kanban", label: "看板" },
];

function buttons(host: HTMLElement): HTMLButtonElement[] {
	return Array.from(host.querySelectorAll("button"));
}

describe("FilterGroup", () => {
	it("每个选项渲染一个按钮，文案与顺序一致", () => {
		const host = mount(() => (
			<FilterGroup options={OPTIONS} selected="list" onChange={() => {}} />
		));
		const btns = buttons(host);
		expect(btns).toHaveLength(2);
		expect(btns.map((b) => b.textContent)).toEqual(["列表", "看板"]);
	});

	it("按钮是 type=button，放进表单不会误触发提交", () => {
		const host = mount(() => (
			<FilterGroup options={OPTIONS} selected="list" onChange={() => {}} />
		));
		expect(buttons(host).map((b) => b.type)).toEqual(["button", "button"]);
	});

	it("aria-pressed 只落在选中项上", () => {
		const host = mount(() => (
			<FilterGroup options={OPTIONS} selected="kanban" onChange={() => {}} />
		));
		expect(buttons(host).map((b) => b.getAttribute("aria-pressed"))).toEqual([
			"false",
			"true",
		]);
	});

	it("选中项用 primary 变体、未选中项用 secondary 变体（与 <Button> 完全一致）", () => {
		const host = mount(() => (
			<FilterGroup options={OPTIONS} selected="list" onChange={() => {}} />
		));
		const [active, inactive] = buttons(host);
		const primary = mount(() => (
			<Button variant="primary" size="sm">
				参照
			</Button>
		)).querySelector("button");
		const secondary = mount(() => (
			<Button variant="secondary" size="sm">
				参照
			</Button>
		)).querySelector("button");
		expect(active.className).toBe(primary?.className);
		expect(inactive.className).toBe(secondary?.className);
	});

	it("点击未选中项以该选项的 value 回调一次", () => {
		const onChange = vi.fn();
		const host = mount(() => (
			<FilterGroup options={OPTIONS} selected="list" onChange={onChange} />
		));
		buttons(host)[1].click();
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith("kanban");
	});

	it("class 透传到容器（各页用它做布局，不能丢）", () => {
		const host = mount(() => (
			<FilterGroup
				options={OPTIONS}
				selected="list"
				onChange={() => {}}
				class="probe-layout"
			/>
		));
		const group = host.firstElementChild;
		expect(group?.className).toContain("probe-layout");
		// 容器类不应落到按钮上：分段控件自身排列用的类不是按钮类
		expect(buttons(host)[0].className).not.toContain("probe-layout");
	});
});
