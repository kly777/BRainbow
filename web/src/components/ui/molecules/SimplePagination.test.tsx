// ── SimplePagination 契约测试 ──
// 3 个调用点（file 列表 / mem 记忆管理 / bookmark 书签管理）共用这一条分页栏。
// 迁移到 <Button variant="secondary" size="md"> 后，禁用态判定与"只渲染一页时不出现"
// 是最容易回归的两点，故作为主要断言。

import Button from "@components/ui/atoms/Button.tsx";
import SimplePagination from "@components/ui/molecules/SimplePagination.tsx";
import type { ComponentProps, JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

function mount(node: () => JSX.Element): HTMLDivElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	return host;
}

type PaginationProps = ComponentProps<typeof SimplePagination>;

function setup(overrides: Partial<PaginationProps> = {}): HTMLDivElement {
	const props: PaginationProps = {
		page: 2,
		totalPages: 5,
		total: 90,
		onPrev: () => {},
		onNext: () => {},
		...overrides,
	};
	return mount(() => <SimplePagination {...props} />);
}

function byLabel(host: HTMLElement, label: string): HTMLButtonElement {
	const el = host.querySelector(`button[aria-label='${label}']`);
	if (!el) throw new Error(`未找到按钮：${label}`);
	return el as HTMLButtonElement;
}

describe("SimplePagination", () => {
	it("只有一页时不渲染分页栏", () => {
		const host = setup({ page: 1, totalPages: 1, total: 3 });
		expect(host.querySelector("nav")).toBeNull();
	});

	it("渲染分页导航、两个按钮与页码文案", () => {
		const host = setup({ page: 2, totalPages: 5, total: 90 });
		expect(host.querySelector("nav")?.getAttribute("aria-label")).toBe("分页");
		expect(byLabel(host, "上一页").textContent).toContain("上一页");
		expect(byLabel(host, "下一页").textContent).toContain("下一页");
		expect(host.textContent).toContain("第 2 / 5 页（共 90 条）");
	});

	it("首页禁用「上一页」、末页禁用「下一页」，中间页都可用", () => {
		const first = setup({ page: 1 });
		expect(byLabel(first, "上一页").disabled).toBe(true);
		expect(byLabel(first, "下一页").disabled).toBe(false);

		const last = setup({ page: 5 });
		expect(byLabel(last, "上一页").disabled).toBe(false);
		expect(byLabel(last, "下一页").disabled).toBe(true);

		const middle = setup({ page: 3 });
		expect(byLabel(middle, "上一页").disabled).toBe(false);
		expect(byLabel(middle, "下一页").disabled).toBe(false);
	});

	it("disabled prop 让两个按钮同时不可用（列表加载中）", () => {
		const host = setup({ page: 3, disabled: true });
		expect(byLabel(host, "上一页").disabled).toBe(true);
		expect(byLabel(host, "下一页").disabled).toBe(true);
	});

	it("点击按钮分别触发 onPrev / onNext", () => {
		const onPrev = vi.fn();
		const onNext = vi.fn();
		const host = setup({ page: 3, onPrev, onNext });
		byLabel(host, "上一页").click();
		byLabel(host, "下一页").click();
		expect(onPrev).toHaveBeenCalledTimes(1);
		expect(onNext).toHaveBeenCalledTimes(1);
	});

	it("按钮复用 secondary + md 变体（与 <Button> 完全一致）", () => {
		const host = setup();
		const reference = mount(() => (
			<Button variant="secondary" size="md">
				参照
			</Button>
		)).querySelector("button");
		expect(byLabel(host, "上一页").className).toBe(reference?.className);
		expect(byLabel(host, "下一页").className).toBe(reference?.className);
	});
});
