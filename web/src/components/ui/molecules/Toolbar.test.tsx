// ── Toolbar：详情页工具条的形态契约 ──
// 这里的回归点很具体：返回入口**必须是系统里的 ghost 按钮**。
// 改造前它自写了一个 `border-radius: var(--radius-full)` 的胶囊按钮 —— 全站按钮是
// radius-sm / radius-md，只有它是胶囊，于是详情页顶部那个描边胶囊成了页面上最抢眼的元素；
// 而且它是"设计系统未自用"的漏网之鱼：当时按 `.btn*` 前缀统计重复定义，
// `.back-btn` 因为**后缀**而没被数进去（教训：按名字统计只能定位候选）。

import Button from "@components/ui/atoms/Button.tsx";
import Toolbar from "@components/ui/molecules/Toolbar.tsx";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

function mount(node: () => JSX.Element): HTMLDivElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	return host;
}

function referenceClass(node: () => JSX.Element, sel = "button"): string {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	const cls = host.querySelector(sel)?.className ?? "";
	host.remove();
	return cls;
}

describe("Toolbar", () => {
	it("返回入口复用 ghost 按钮，而不是自写样式", () => {
		const host = mount(() => (
			<Toolbar backLabel="返回列表" onBack={() => {}} />
		));
		const back = host.querySelector("button");
		const base = referenceClass(() => (
			<Button variant="ghost">返回列表</Button>
		));
		// 共享类都在，且只多一个本组件的调整类（负外边距 / 配色）
		const baseSet = new Set(base.split(" "));
		const backSet = new Set((back?.className ?? "").split(" "));
		for (const c of baseSet) expect(backSet.has(c)).toBe(true);
		expect([...backSet].filter((c) => !baseSet.has(c))).toHaveLength(1);
	});

	it("显示返回文案与回退图标，点击回调 onBack", () => {
		const onBack = vi.fn();
		const host = mount(() => <Toolbar backLabel="任务列表" onBack={onBack} />);
		const back = host.querySelector("button");
		expect(back?.textContent?.trim()).toBe("任务列表");
		expect(back?.querySelector("svg")).not.toBeNull();
		back?.click();
		expect(onBack).toHaveBeenCalledTimes(1);
	});

	it("标题可选：给了就渲染在返回之后，标题是纯文本（h1 由外壳负责）", () => {
		const withTitle = mount(() => (
			<Toolbar title="本体甲" backLabel="返回" onBack={() => {}} />
		));
		expect(withTitle.textContent).toContain("本体甲");
		expect(withTitle.querySelector("h1")).toBeNull();

		const without = mount(() => <Toolbar backLabel="返回" onBack={() => {}} />);
		expect(without.textContent).not.toContain("本体甲");
	});

	it("动作区渲染在标题之后（并在右侧）", () => {
		const host = mount(() => (
			<Toolbar title="详情" backLabel="返回" onBack={() => {}}>
				<Button variant="secondary" size="sm">
					编辑
				</Button>
			</Toolbar>
		));
		const texts = Array.from(host.querySelectorAll("button")).map((b) =>
			b.textContent?.trim(),
		);
		expect(texts).toEqual(["返回", "编辑"]);
	});
});
