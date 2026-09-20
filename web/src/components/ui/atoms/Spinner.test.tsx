// ── Spinner 渲染测试 ──
// 钉住两条：动画名与关键帧同文件（/conv/search 曾因跨文件引用 @keyframes 而静止）、
// 可访问名的取舍（带文案则它是 status，否则对读屏器隐藏）。

import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import Spinner from "./Spinner.tsx";

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node as never, host);
	return host;
}

describe("Spinner", () => {
	it("默认 16px / 2px 粗，且对读屏器隐藏（旁边通常有可见文案）", () => {
		const host = mount(() => <Spinner />);
		const el = host.querySelector("span") as HTMLSpanElement;
		expect(el.style.width).toBe("16px");
		expect(el.style.height).toBe("16px");
		expect(el.style.borderWidth).toBe("2px");
		expect(el.getAttribute("aria-hidden")).toBe("true");
		expect(el.getAttribute("aria-label")).toBeNull();
	});

	it("尺寸可覆盖", () => {
		const host = mount(() => <Spinner size={24} thickness={3} />);
		const el = host.querySelector("span") as HTMLSpanElement;
		expect(el.style.width).toBe("24px");
		expect(el.style.borderWidth).toBe("3px");
	});

	it("带 label 时是 status 且不再隐藏", () => {
		const host = mount(() => <Spinner label="加载中" />);
		const el = host.querySelector("span") as HTMLSpanElement;
		expect(el.getAttribute("role")).toBe("status");
		expect(el.getAttribute("aria-label")).toBe("加载中");
		expect(el.getAttribute("aria-hidden")).toBeNull();
	});

	it("旋转动画由本文件的类名提供（不与关键帧分离）", () => {
		const host = mount(() => <Spinner />);
		const el = host.querySelector("span") as HTMLSpanElement;
		// vite 的 CSS 处理在测试环境不注入样式，类名存在即可（契约测试另查 CSS）
		expect(el.className).toContain("spinner");
	});
});
