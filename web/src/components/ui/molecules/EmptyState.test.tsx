// ── EmptyState 渲染测试 ──
// 钉住槽位契约：title / hint / icon / action 各自渲染，compact 加紧凑类，
// 都没有时只剩容器（调用方靠它做居中，不塌成 null）。

import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import EmptyState from "./EmptyState.tsx";

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node as never, host);
	return host;
}

describe("EmptyState", () => {
	it("只给 title 时渲染一行主文案", () => {
		const host = mount(() => <EmptyState title="暂无数据" />);
		expect(host.textContent).toBe("暂无数据");
		expect(host.querySelectorAll("p")).toHaveLength(1);
	});

	it("title + hint + action 三层都在，且动作在最后", () => {
		const host = mount(() => (
			<EmptyState
				title="档案柜还是空的"
				hint="添加第一张记忆卡"
				action={<button type="button">去添加</button>}
			/>
		));
		expect(host.textContent).toContain("档案柜还是空的");
		expect(host.textContent).toContain("添加第一张记忆卡");
		const paras = Array.from(host.querySelectorAll("p")).map(
			(p) => p.textContent,
		);
		expect(paras).toEqual(["档案柜还是空的", "添加第一张记忆卡"]);
		const btn = host.querySelector("button") as HTMLButtonElement;
		expect(btn.textContent).toBe("去添加");
		// 动作容器是根元素的最后一个孩子（"动作在底部"是这层的契约）
		const root = host.querySelector("div") as HTMLDivElement;
		expect(root.lastElementChild?.contains(btn)).toBe(true);
	});

	it("hint 里的链接原样渲染（引导可以直接点）", () => {
		const host = mount(() => (
			<EmptyState title="空" hint={<a href="/memory/add">去添加</a>} />
		));
		const link = host.querySelector("a") as HTMLAnchorElement;
		expect(link.getAttribute("href")).toBe("/memory/add");
	});

	it("compact 变体加紧凑类，默认不加", () => {
		const compact = mount(() => <EmptyState title="无数据" compact />);
		const normal = mount(() => <EmptyState title="无数据" />);
		expect(
			(compact.querySelector("div") as HTMLDivElement).className,
		).toContain("compact");
		expect(
			(normal.querySelector("div") as HTMLDivElement).className,
		).not.toContain("compact");
	});

	it("class 透传到根元素（调用方覆盖内边距用）", () => {
		const host = mount(() => <EmptyState title="空" class="mine" />);
		expect((host.querySelector("div") as HTMLDivElement).className).toContain(
			"mine",
		);
	});
});
