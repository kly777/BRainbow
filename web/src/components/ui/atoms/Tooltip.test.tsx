// ── Tooltip：纯文本与富内容两种气泡 ──

import { type JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import Tooltip from "./Tooltip.tsx";

/** 渲染一个 tooltip，返回宿主元素（Tooltip 的 wrap span）与清理函数 */
function setup(children: () => JSX.Element) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const dispose = render(children, host);
	const wrap = host.firstElementChild as HTMLElement;
	return {
		wrap,
		dispose: () => {
			dispose();
			host.remove();
		},
	};
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("Tooltip", () => {
	it("hover 后渲染纯文本提示", async () => {
		const { wrap, dispose } = setup(() => (
			<Tooltip label="复制链接" delayMs={0}>
				<button type="button">复制</button>
			</Tooltip>
		));
		wrap.dispatchEvent(new MouseEvent("mouseenter"));
		await tick();
		expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
			"复制链接",
		);
		dispose();
	});

	it("富内容渲染为 rich 气泡（多行信息卡）", async () => {
		const { wrap, dispose } = setup(() => (
			<Tooltip content={<span>完整文件名.png</span>} delayMs={0}>
				<button type="button">文件名</button>
			</Tooltip>
		));
		wrap.dispatchEvent(new MouseEvent("mouseenter"));
		await tick();
		const tip = document.querySelector('[role="tooltip"]');
		expect(tip?.textContent).toBe("完整文件名.png");
		// rich 类来自 Tooltip.module.css，样式类名经 CSS Modules 哈希，这里只校验带上了一个额外类
		expect((tip?.className ?? "").split(" ").length).toBeGreaterThan(1);
		dispose();
	});

	it("mouseleave 后移除气泡", async () => {
		const { wrap, dispose } = setup(() => (
			<Tooltip label="提示" delayMs={0}>
				<button type="button">按钮</button>
			</Tooltip>
		));
		wrap.dispatchEvent(new MouseEvent("mouseenter"));
		await tick();
		expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
		wrap.dispatchEvent(new MouseEvent("mouseleave"));
		await tick();
		expect(document.querySelector('[role="tooltip"]')).toBeNull();
		dispose();
	});

	it("class 属性附加到宿主元素（撑满父容器用）", () => {
		const { wrap, dispose } = setup(() => (
			<Tooltip label="提示" class="host-class">
				<button type="button">按钮</button>
			</Tooltip>
		));
		expect(wrap.className).toContain("host-class");
		dispose();
	});
});
