// ── 布局原语契约测试 ──
// jsdom 不应用 CSS Module 样式，故不断言视觉，只锁死"能安全替换进现有标记"
// 的三条前提：
//   1. 只渲染一个元素（不引入额外 DOM 层，否则会破坏子选择器与布局）
//   2. class 合并而非覆盖（调用方自己的 CSS Module 类必须保留）
//   3. 其余属性透传（onClick / data-* / style 等）
// 这三条一旦破，替换既有 <div class={styles.x}> 就会静默改结构。

import { Row, Stack } from "@components/ui/atoms/Layout.tsx";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

function mount(node: () => JSX.Element): HTMLDivElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	return host;
}

describe("布局原语：DOM 契约", () => {
	it("Row 只渲染一个元素，子节点直接落在这个元素里", () => {
		const host = mount(() => (
			<Row>
				<span>a</span>
				<span>b</span>
			</Row>
		));
		expect(host.children.length).toBe(1);
		expect(host.firstElementChild?.children.length).toBe(2);
	});

	it("Stack 只渲染一个元素", () => {
		const host = mount(() => (
			<Stack>
				<span>a</span>
			</Stack>
		));
		expect(host.children.length).toBe(1);
	});

	it("class 合并而非覆盖：调用方类名必须保留", () => {
		const host = mount(() => (
			<Row class="my-filter-row" gap="md">
				<span>a</span>
			</Row>
		));
		expect(host.firstElementChild?.className).toContain("my-filter-row");
	});
});

describe("布局原语：修饰 prop 生效", () => {
	const classCount = (host: HTMLDivElement) =>
		(host.firstElementChild?.className ?? "").split(/\s+/).filter(Boolean)
			.length;

	it("每个修饰 prop 都会追加类名", () => {
		const bare = mount(() => <Row />);
		const full = mount(() => (
			<Row gap="md" align="stretch" justify="between" wrap />
		));
		// 基础 1 个 + gap/align/justify/wrap 共 5 个
		expect(classCount(full)).toBeGreaterThan(classCount(bare));
		expect(classCount(full)).toBe(5);
	});

	it("gap 档位不同 → 类名不同", () => {
		const a = mount(() => <Row gap="xs" />).firstElementChild?.className;
		const b = mount(() => <Row gap="lg" />).firstElementChild?.className;
		expect(a).not.toBe(b);
	});

	it("省略修饰 prop 时不产生多余类名", () => {
		expect(classCount(mount(() => <Row />))).toBe(1);
		expect(classCount(mount(() => <Stack />))).toBe(1);
	});

	it("gap='none' 仍然产出类名（显式归零 ≠ 未设置）", () => {
		expect(classCount(mount(() => <Row gap="none" />))).toBe(2);
	});
});

describe("布局原语：属性透传", () => {
	it("onClick / data-* / id 透传到根元素", () => {
		const onClick = vi.fn();
		const host = mount(() => (
			<Row id="probe" data-role="toolbar" onClick={onClick}>
				<span>a</span>
			</Row>
		));
		const el = host.firstElementChild as HTMLElement;
		expect(el.id).toBe("probe");
		expect(el.dataset.role).toBe("toolbar");
		el.click();
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("调用方传入的 style 不被吞掉", () => {
		const host = mount(() => <Stack style={{ "max-width": "10rem" }} />);
		expect((host.firstElementChild as HTMLElement).style.maxWidth).toBe(
			"10rem",
		);
	});
});
