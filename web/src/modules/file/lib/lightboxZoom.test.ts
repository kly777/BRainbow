// ── 灯箱缩放的数学（纯函数） ──
//
// 重点是"以指针为中心"的滚动补偿，以及"100% = 原始像素"的显示口径。

import { describe, expect, it } from "vitest";
import {
	canZoomIn,
	canZoomOut,
	clampScale,
	MAX_SCALE,
	MIN_SCALE,
	pixelPercent,
	stepScale,
	toggledScale,
	zoomedScroll,
} from "./lightboxZoom.ts";

describe("缩放倍数", () => {
	it("夹在 1..8 之间（不放大到比适应更小，也不无限放大）", () => {
		expect(clampScale(0.2)).toBe(MIN_SCALE);
		expect(clampScale(100)).toBe(MAX_SCALE);
		expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
		expect(clampScale(2.5)).toBe(2.5);
	});

	it("按乘法步进：任何档位的手感一致", () => {
		expect(stepScale(1, 1)).toBeCloseTo(1.25);
		expect(stepScale(4, 1)).toBeCloseTo(5);
		// 缩小同理（4 → 3.2，而不是 4−1=3 那种"高档位无感"
		expect(stepScale(4, -1)).toBeCloseTo(3.2);
	});

	it("到两端就停住（按钮据此置灰）", () => {
		expect(stepScale(MAX_SCALE, 1)).toBe(MAX_SCALE);
		expect(stepScale(MIN_SCALE, -1)).toBe(MIN_SCALE);
		expect(canZoomIn(MAX_SCALE)).toBe(false);
		expect(canZoomOut(MIN_SCALE)).toBe(false);
		expect(canZoomIn(1)).toBe(true);
	});
});

describe("以指针为中心", () => {
	it("放大后指针下的内容留在指针处", () => {
		// 指针在容器内 100px 处，容器已滚动 50px → 内容坐标 150
		// 放大 2 倍后该内容坐标到 300，要让它仍在 100px 处 → 滚动 200
		expect(zoomedScroll(100, 50, 2)).toBe(200);
	});

	it("倍率不变时不改变滚动位置", () => {
		expect(zoomedScroll(100, 50, 1)).toBe(50);
	});

	it("缩小回去能还原（可逆）", () => {
		const afterZoomIn = zoomedScroll(100, 50, 2);
		expect(zoomedScroll(100, afterZoomIn, 0.5)).toBe(50);
	});

	it("未滚动且指针在左上角时不动", () => {
		expect(zoomedScroll(0, 0, 3)).toBe(0);
	});
});

describe("显示比例（100% = 原始像素）", () => {
	it("按渲染宽度 / 原始宽度算", () => {
		// 2000px 宽的图在 500px 的可视区里"适应窗口" → 25%
		expect(pixelPercent(500, 2000)).toBe(25);
		// 双击切到 1:1 → 100%
		expect(pixelPercent(2000, 2000)).toBe(100);
	});

	it("拿不到原始尺寸时返回 0（不显示 NaN%）", () => {
		expect(pixelPercent(500, 0)).toBe(0);
		expect(pixelPercent(500, Number.NaN)).toBe(0);
	});
});

describe("双击切换", () => {
	it("适应状态 → 原始像素（1:1）", () => {
		expect(toggledScale(1, 4)).toBe(4);
	});

	it("已放大 → 回到适应", () => {
		expect(toggledScale(4, 4)).toBe(MIN_SCALE);
		expect(toggledScale(1.25, 4)).toBe(MIN_SCALE);
	});

	it("小图（1:1 比适应还小）也不会缩到比适应更小", () => {
		// 一张 100px 的图在 800px 可视区里，oneToOne 会算出 0.125 → 夹到 1
		expect(toggledScale(1, 0.125)).toBe(MIN_SCALE);
	});
});
