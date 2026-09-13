// ── BackLink：详情页返回链接契约 ──
// 它取代了四处各写一份的返回标签，最要紧的是**语义不能退化**：
// 必须是真正的 <a href>（可中键新开 / 可复制链接），而不是按钮 —— 这正是它没有
// 直接复用 Toolbar（返回按钮）的原因。这里用真实 Router 渲染，不 mock @solidjs/router，
// 免得把被测的连接行为换成测试替身。

import { Route, Router } from "@solidjs/router";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import BackLink from "./BackLink.tsx";

function mount(node: () => JSX.Element): HTMLDivElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	// <A> 依赖路由上下文（内部 useRoute/useResolvedPath），所以必须放在 Router 的
	// 某条路由里渲染；这里用真实 Router 而不是 mock，免得把被测的链接行为换成测试替身
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

const link = (host: HTMLElement) => host.querySelector("a");

describe("BackLink", () => {
	it("渲染为可导航的 <a href>（不是按钮）", () => {
		const host = mount(() => <BackLink href="/reading" label="文章列表" />);
		expect(link(host)?.getAttribute("href")).toBe("/reading");
		expect(host.querySelector("button")).toBeNull();
	});

	it("文案与图标都在链接内（图标是装饰，不额外占用可访问名）", () => {
		const host = mount(() => <BackLink href="/reading" label="文章列表" />);
		expect(link(host)?.textContent?.trim()).toBe("文章列表");
		expect(link(host)?.querySelector("svg")).not.toBeNull();
	});

	it("默认图标 14，可取 16（各页原有取值不同）", () => {
		const small = mount(() => <BackLink href="/a" label="返回" />);
		const big = mount(() => <BackLink href="/a" label="返回" size={16} />);
		const dim = (h: HTMLDivElement) => ({
			w: h.querySelector("svg")?.getAttribute("width"),
			h: h.querySelector("svg")?.getAttribute("height"),
		});
		expect(dim(small)).toEqual({ w: "14", h: "14" });
		expect(dim(big)).toEqual({ w: "16", h: "16" });
	});

	it("调用方类与共享类同时保留（本页布局覆盖靠它）", () => {
		const base = link(
			mount(() => <BackLink href="/a" label="返回" />),
		)?.className;
		const withClass = link(
			mount(() => <BackLink href="/a" label="返回" class="probe-layout" />),
		)?.className;
		// 注意 <A> 自己还会追加路由状态类（inactive / active），所以不能断言"调用方类在最后"，
		// 只能断言两类都在、且恰好只多一个。覆盖安全由共享类的 :where() 低特异度保证，
		// 不依赖 class 属性里的先后顺序。
		const baseSet = new Set((base ?? "").split(" "));
		const withSet = new Set((withClass ?? "").split(" "));
		for (const c of baseSet) expect(withSet.has(c)).toBe(true);
		expect([...withSet].filter((c) => !baseSet.has(c))).toEqual([
			"probe-layout",
		]);
	});
});
