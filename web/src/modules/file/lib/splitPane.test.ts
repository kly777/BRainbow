// ── 详情页两栏的分隔条拖拽（纯函数边界） ──
//
// 存的是侧栏**像素宽度**而不是比例：侧栏里是键值对文本、字号固定，"多宽能读"是绝对量，
// 按比例存会让窗口一缩侧栏就窄得没法看。

import { describe, expect, it } from "vitest";
import {
	clampSideWidth,
	draggedSideWidth,
	parseSideWidth,
	SIDE_DEFAULT_PX,
	SIDE_MAX_PX,
	SIDE_MIN_PX,
	sideWidthKey,
} from "./splitPane.ts";

describe("侧栏宽度", () => {
	it("默认值落在区间内，且与旧样式的 18rem 一致", () => {
		expect(SIDE_DEFAULT_PX).toBe(288);
		expect(SIDE_MIN_PX).toBeLessThan(SIDE_DEFAULT_PX);
		expect(SIDE_MAX_PX).toBeGreaterThan(SIDE_DEFAULT_PX);
	});

	it("夹到上下限", () => {
		expect(clampSideWidth(10)).toBe(SIDE_MIN_PX);
		expect(clampSideWidth(9999)).toBe(SIDE_MAX_PX);
		expect(clampSideWidth(320.4)).toBe(320);
	});

	it("非数字回默认值（存档被写坏时不该让布局崩）", () => {
		expect(clampSideWidth(Number.NaN)).toBe(SIDE_DEFAULT_PX);
		expect(parseSideWidth(null)).toBe(SIDE_DEFAULT_PX);
		expect(parseSideWidth("abc")).toBe(SIDE_DEFAULT_PX);
		expect(parseSideWidth("360")).toBe(360);
		expect(parseSideWidth("9999")).toBe(SIDE_MAX_PX);
	});

	it("键按用途命名（不与其他偏好混）", () => {
		expect(sideWidthKey).toBe("file:detail:side-width");
	});
});

describe("拖拽", () => {
	it("分隔条在侧栏左边缘：指针右移 = 侧栏变窄", () => {
		// 起点 300px，指针右移 40 → 侧栏 260
		expect(draggedSideWidth(300, 500, 540)).toBe(260);
		// 指针左移 = 变宽
		expect(draggedSideWidth(300, 500, 460)).toBe(340);
	});

	it("拖过头时夹住，不会把预览挤没", () => {
		expect(draggedSideWidth(300, 500, 5000)).toBe(SIDE_MIN_PX);
		expect(draggedSideWidth(300, 500, -5000)).toBe(SIDE_MAX_PX);
	});

	it("没移动就原样返回", () => {
		expect(draggedSideWidth(320, 500, 500)).toBe(320);
	});
});
