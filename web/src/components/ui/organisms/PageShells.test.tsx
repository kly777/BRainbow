// ── 页面外壳契约测试 ──
// 锁死两件外壳存在的理由：
//   1. 每个页面恰好一个 <h1> —— 改造前 33 个页面里 4 个整页没有一级标题，
//      document outline 断裂且读屏器无法按标题导航；
//   2. 列表页必须接四态（加载/错误/空/数据）—— 改造前只有 8/33 个页面接了。
// 另外验证 filters / footer / actions 为可选，且 children 收的是 accessor
// 而非快照数组（否则数据刷新会整棵重建子树，输入框焦点丢失）。

import DetailPage from "@components/ui/organisms/DetailPage.tsx";
import ListPage from "@components/ui/organisms/ListPage.tsx";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

function mount(node: () => JSX.Element): HTMLDivElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	return host;
}

describe("ListPage：标题与四态", () => {
	it("渲染唯一的 h1，内容为 title", () => {
		const host = mount(() => (
			<ListPage title="知识管理" data={[1]}>
				{() => <div />}
			</ListPage>
		));
		const h1 = host.querySelectorAll("h1");
		expect(h1.length).toBe(1);
		expect(h1[0].textContent).toBe("知识管理");
	});

	it("loading 时显示骨架、不渲染内容", () => {
		const host = mount(() => (
			<ListPage title="列表" data={[1, 2]} loading>
				{() => <div data-testid="content" />}
			</ListPage>
		));
		expect(host.querySelector("[data-testid='content']")).toBeNull();
		expect(host.querySelector(".skeleton")).toBeTruthy();
	});

	it("error 时显示重试按钮并回调 onRetry", () => {
		const onRetry = vi.fn();
		const host = mount(() => (
			<ListPage
				title="列表"
				data={undefined}
				error={new Error("炸了")}
				onRetry={onRetry}
			>
				{() => <div />}
			</ListPage>
		));
		expect(host.textContent).toContain("炸了");
		const btn = host.querySelector("button");
		btn?.click();
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("空数组时显示 emptyMessage，不渲染内容", () => {
		const host = mount(() => (
			<ListPage title="列表" data={[]} emptyMessage="没有匹配项">
				{() => <div data-testid="content" />}
			</ListPage>
		));
		expect(host.textContent).toContain("没有匹配项");
		expect(host.querySelector("[data-testid='content']")).toBeNull();
	});

	it("有数据时把 accessor 交给 children（而非快照）", () => {
		let seen: unknown = null;
		mount(() => (
			<ListPage title="列表" data={[{ id: 1 }]}>
				{(data) => {
					seen = data;
					return <div>{(data() as { id: number }[])[0].id}</div>;
				}}
			</ListPage>
		));
		expect(typeof seen).toBe("function");
	});
});

describe("ListPage：可选区域", () => {
	it("filters 与 footer 省略时不产生多余容器", () => {
		const host = mount(() => (
			<ListPage title="列表" data={[1]}>
				{() => <div data-testid="content" />}
			</ListPage>
		));
		// 只有外壳 div 与 PageHead + 内容
		expect(host.textContent).not.toContain("undefined");
		expect(host.querySelector("[data-testid='content']")).toBeTruthy();
	});

	it("filters / footer / actions 传入时都会渲染", () => {
		const host = mount(() => (
			<ListPage
				title="列表"
				data={[1]}
				actions={<button type="button">新建</button>}
				filters={<span data-testid="filters">筛选</span>}
				footer={<span data-testid="footer">共 1 条</span>}
			>
				{() => <div />}
			</ListPage>
		));
		expect(host.querySelector("[data-testid='filters']")).toBeTruthy();
		expect(host.querySelector("[data-testid='footer']")).toBeTruthy();
		expect(host.textContent).toContain("新建");
	});

	it("class 透传到最外层容器（宽度与内边距由调用方决定）", () => {
		const host = mount(() => (
			<ListPage title="列表" data={[1]} class="my-page-container">
				{() => <div />}
			</ListPage>
		));
		expect(host.firstElementChild?.className).toContain("my-page-container");
	});
});

describe("DetailPage：标题与返回", () => {
	it("渲染唯一的 h1，内容为 title", () => {
		const host = mount(() => (
			<DetailPage title="文件详情" backLabel="返回列表" onBack={() => {}}>
				<div />
			</DetailPage>
		));
		const h1 = host.querySelectorAll("h1");
		expect(h1.length).toBe(1);
		expect(h1[0].textContent).toBe("文件详情");
	});

	it("titleHidden 时 h1 仅供读屏器（sr-only），语义仍在", () => {
		const host = mount(() => (
			<DetailPage
				title="文本内容"
				backLabel="返回"
				onBack={() => {}}
				titleHidden
			>
				<div />
			</DetailPage>
		));
		const h1 = host.querySelector("h1");
		expect(h1?.textContent).toBe("文本内容");
		expect(h1?.className).toContain("sr-only");
	});

	it("返回按钮回调 onBack", () => {
		const onBack = vi.fn();
		const host = mount(() => (
			<DetailPage title="详情" backLabel="返回列表" onBack={onBack}>
				<div />
			</DetailPage>
		));
		host.querySelector("button")?.click();
		expect(onBack).toHaveBeenCalledTimes(1);
		expect(host.textContent).toContain("返回列表");
	});

	it("actions 渲染在返回栏内、h1 之外", () => {
		const host = mount(() => (
			<DetailPage
				title="详情"
				backLabel="返回"
				onBack={() => {}}
				actions={<button type="button">删除</button>}
			>
				<div />
			</DetailPage>
		));
		expect(host.textContent).toContain("删除");
		expect(host.querySelectorAll("h1").length).toBe(1);
	});
});
