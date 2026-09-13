// ── ConvTopBar：对话详情顶栏（ConvDetail / ConvConcept 共用） ──
// 本轮把自写的返回标签换成共享 <BackLink>，这里钉住调用点接线是否正确：
// 返回链接的 href 与文案、h1 标题、类型标签的中文映射、日期。
// 组件是纯 props（不碰 hooks），因此直接渲染即可，只有 <A> 需要路由上下文。

import { Route, Router } from "@solidjs/router";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import ConvTopBar from "./ConvTopBar.tsx";

function mount(node: () => JSX.Element): HTMLDivElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(
		() => (
			<Router>
				<Route path="/" component={() => node()} />
			</Router>
		),
		host,
	);
	return host;
}

describe("ConvTopBar", () => {
	it("返回链接指向传入的 href，文案是「搜索」", () => {
		const host = mount(() => (
			<ConvTopBar title="标题" type="concept" backHref="/conv?q=x" />
		));
		const back = host.querySelector("a");
		expect(back?.getAttribute("href")).toBe("/conv?q=x");
		expect(back?.textContent?.trim()).toBe("搜索");
	});

	it("标题是一级标题（本页唯一的 h1）", () => {
		const host = mount(() => (
			<ConvTopBar title="对话标题" type="concept" backHref="/conv" />
		));
		expect(host.querySelectorAll("h1")).toHaveLength(1);
		expect(host.querySelector("h1")?.textContent).toBe("对话标题");
	});

	it("类型标签走中文映射，未知类型原样显示", () => {
		const known = mount(() => (
			<ConvTopBar title="t" type="concept" backHref="/conv" />
		));
		expect(known.textContent).toContain("概念");
		const unknown = mount(() => (
			<ConvTopBar title="t" type="weird" backHref="/conv" />
		));
		expect(unknown.textContent).toContain("weird");
	});

	it("日期可选：传了就显示", () => {
		const withDate = mount(() => (
			<ConvTopBar title="t" type="concept" date="2026-08-22" backHref="/conv" />
		));
		expect(withDate.textContent).toContain("2026-08-22");
		const without = mount(() => (
			<ConvTopBar title="t" type="concept" backHref="/conv" />
		));
		expect(without.textContent).not.toContain("2026-08-22");
	});
});
