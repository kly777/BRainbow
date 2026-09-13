// ── PaginationBar 渲染测试 ──
// 本组件是表单原语迁移中"只迁了一半"的例子，且这个"一半"是刻意的：
//   - 跳转页码输入框迁到了 `Input`（`mono` + 宽度/高度作为调用方差异保留）；
//   - 「每页」下拉仍是**原生 `<select>`**（外层有 `<label>` 包裹，可访问名来自
//     label 文本），它的 CSS 也完整保留。
// 这组断言把两侧的现状都钉住，避免以后有人"顺手"把 select 的样式按原语收窄
// 却发现元素没迁（那会丢边框与内边距）。

import type { ComponentProps } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import PaginationBar from "./PaginationBar.tsx";

type BarProps = ComponentProps<typeof PaginationBar>;

function props(over: Partial<BarProps> = {}): BarProps {
	return {
		total: 100,
		page: 2,
		pageSize: 20,
		totalPages: 5,
		filtered: false,
		loading: false,
		jumpValue: "",
		onJumpInput: vi.fn(),
		onJump: vi.fn(),
		onPageSizeChange: vi.fn(),
		onPrev: vi.fn(),
		onNext: vi.fn(),
		...over,
	};
}

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node as () => never, host);
	return host;
}

describe("PaginationBar", () => {
	it("跳转输入框已迁到原语且带可访问名", () => {
		const host = mount(() => <PaginationBar {...props()} />);
		const input = host.querySelector(
			"input[aria-label='跳转页码']",
		) as HTMLInputElement;
		expect(input).toBeTruthy();
		expect(input.className).toContain("_control_");
	});

	it("「每页」下拉仍是原生 select，可访问名来自包裹的 label", () => {
		const host = mount(() => <PaginationBar {...props()} />);
		const select = host.querySelector("select") as HTMLSelectElement;
		expect(select?.tagName).toBe("SELECT");
		const label = select?.closest("label");
		expect(label?.textContent).toContain("每页");
	});

	it("切换每页条数回调数值", () => {
		const onPageSizeChange = vi.fn();
		const host = mount(() => (
			<PaginationBar {...props({ onPageSizeChange })} />
		));
		const select = host.querySelector("select") as HTMLSelectElement;
		select.value = "50";
		select.dispatchEvent(new Event("change", { bubbles: true }));
		expect(onPageSizeChange).toHaveBeenCalledWith(50);
	});

	it("首页禁用「上一页」、末页禁用「下一页」", () => {
		const first = mount(() => <PaginationBar {...props({ page: 1 })} />);
		expect(
			(first.querySelector("button[title='上一页']") as HTMLButtonElement)
				.disabled,
		).toBe(true);

		const last = mount(() => (
			<PaginationBar {...props({ page: 5, totalPages: 5 })} />
		));
		expect(
			(last.querySelector("button[title='下一页']") as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("loading 时两个翻页按钮都禁用", () => {
		const host = mount(() => <PaginationBar {...props({ loading: true })} />);
		for (const t of ["上一页", "下一页"]) {
			expect(
				(host.querySelector(`button[title='${t}']`) as HTMLButtonElement)
					.disabled,
			).toBe(true);
		}
	});

	it("翻页按钮回调", () => {
		const onPrev = vi.fn();
		const onNext = vi.fn();
		const host = mount(() => <PaginationBar {...props({ onPrev, onNext })} />);
		(host.querySelector("button[title='上一页']") as HTMLButtonElement).click();
		(host.querySelector("button[title='下一页']") as HTMLButtonElement).click();
		expect(onPrev).toHaveBeenCalledTimes(1);
		expect(onNext).toHaveBeenCalledTimes(1);
	});

	it("跳转页码会被夹到有效区间", () => {
		const onJump = vi.fn();
		const host = mount(() => (
			<PaginationBar {...props({ jumpValue: "99", onJump })} />
		));
		const form = host.querySelector("form") as HTMLFormElement;
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		// totalPages = 5，99 应被夹到 5
		expect(onJump).toHaveBeenCalledWith(5);
	});

	it("只有一页时不渲染跳转与翻页区", () => {
		const host = mount(() => (
			<PaginationBar {...props({ page: 1, totalPages: 1 })} />
		));
		expect(host.querySelector("input[aria-label='跳转页码']")).toBeNull();
		expect(host.querySelector("button[title='上一页']")).toBeNull();
	});
});
