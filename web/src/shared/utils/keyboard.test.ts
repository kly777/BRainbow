// @vitest-environment jsdom
// ── 键盘让路判定 ──

import { describe, expect, it } from "vite-plus/test";
import { isImeComposing, isTypingTarget } from "./keyboard.ts";

function el(tag: string, editing = false): HTMLElement {
	const node = document.createElement(tag);
	// 用属性而不是 `.contentEditable`：jsdom 没实现那个属性（isContentEditable 同样没有），
	// 而浏览器里两者是一回事
	if (editing) node.setAttribute("contenteditable", "true");
	return node;
}

describe("isTypingTarget", () => {
	it("输入框 / 文本域 / 可编辑区域都让路", () => {
		expect(isTypingTarget(el("input"))).toBe(true);
		expect(isTypingTarget(el("textarea"))).toBe(true);
		expect(isTypingTarget(el("div", true))).toBe(true);
		// 裸属性（<div contenteditable>）在 HTML 里同样是"可编辑"
		const bare = document.createElement("div");
		bare.setAttribute("contenteditable", "");
		expect(isTypingTarget(bare)).toBe(true);
		// 显式关闭的不算
		const off = document.createElement("div");
		off.setAttribute("contenteditable", "false");
		expect(isTypingTarget(off)).toBe(false);
	});

	it("下拉框默认不让路，显式声明后让路", () => {
		expect(isTypingTarget(el("select"))).toBe(false);
		expect(isTypingTarget(el("select"), { includeSelect: true })).toBe(true);
	});

	it("普通元素与空目标不让路", () => {
		expect(isTypingTarget(el("button"))).toBe(false);
		expect(isTypingTarget(el("body"))).toBe(false);
		expect(isTypingTarget(null)).toBe(false);
		expect(isTypingTarget(undefined)).toBe(false);
		// window / document 之类没有 tagName 的目标
		expect(isTypingTarget(window as unknown as EventTarget)).toBe(false);
	});
});

describe("isImeComposing", () => {
	const keydown = (init: KeyboardEventInit) =>
		new KeyboardEvent("keydown", { key: "Enter", ...init });

	it("组字中的按键一律让路（回车在选候选词）", () => {
		expect(isImeComposing(keydown({ isComposing: true }))).toBe(true);
	});

	it("老实现只给 keyCode 229（组字的标志），也认", () => {
		const e = keydown({});
		// jsdom 的 KeyboardEventInit 不吃 keyCode，得直接定义
		Object.defineProperty(e, "keyCode", { value: 229 });
		expect(isImeComposing(e)).toBe(true);
	});

	it("组字之外的按键照常处理", () => {
		expect(isImeComposing(keydown({}))).toBe(false);
		expect(isImeComposing(keydown({ key: "ArrowDown", keyCode: 40 }))).toBe(
			false,
		);
	});
});
