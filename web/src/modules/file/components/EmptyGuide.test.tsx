// ── EmptyGuide：文件库空态引导 ──
// 本轮把上传 CTA 从"裸 <button> + accent 软底自写样式"换成 <Button variant="primary">，
// 这里既钉住行为（点击仍回调、筛选无结果时不出现 CTA），也钉住"确实用的是系统变体"。

import Button from "@components/ui/atoms/Button.tsx";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import EmptyGuide from "./EmptyGuide.tsx";

function mount(node: () => JSX.Element): HTMLDivElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	return host;
}

function cta(host: HTMLElement): HTMLButtonElement | null {
	const el = Array.from(host.querySelectorAll("button")).find((b) =>
		b.textContent?.includes("选择文件上传"),
	);
	return el ?? null;
}

describe("EmptyGuide", () => {
	it("空库时给出上传引导与 CTA", () => {
		const host = mount(() => (
			<EmptyGuide filtered={false} onUpload={() => {}} />
		));
		expect(host.textContent).toContain("文件库还是空的");
		expect(host.textContent).toContain("把文件拖到页面任意位置即可上传");
		expect(cta(host)).not.toBeNull();
	});

	it("筛选无结果时只给提示，不给上传 CTA（免得误导为“还没上传过”）", () => {
		const host = mount(() => (
			<EmptyGuide filtered={true} onUpload={() => {}} />
		));
		expect(host.textContent).toContain("当前筛选条件下没有匹配的文件");
		expect(host.textContent).not.toContain("文件库还是空的");
		expect(cta(host)).toBeNull();
	});

	it("点击 CTA 触发 onUpload 一次", () => {
		const onUpload = vi.fn();
		const host = mount(() => (
			<EmptyGuide filtered={false} onUpload={onUpload} />
		));
		cta(host)?.click();
		expect(onUpload).toHaveBeenCalledTimes(1);
	});

	it("CTA 用 primary 变体（填充色不再是 accent，见 design-tokens.md 的 accent 纪律）", () => {
		const host = mount(() => (
			<EmptyGuide filtered={false} onUpload={() => {}} />
		));
		const reference = mount(() => (
			<Button variant="primary">参照</Button>
		)).querySelector("button");
		const button = cta(host);
		const base = reference?.className ?? "\u0000";
		expect(button?.className).toContain(base);
		// 原语类之后只多一个类：本模块的布局类（外边距），不应再有自写按钮形态
		const extra = (button?.className ?? "")
			.slice(base.length)
			.trim()
			.split(/\s+/)
			.filter(Boolean);
		expect(extra).toHaveLength(1);
		expect(button?.type).toBe("button");
	});
});
