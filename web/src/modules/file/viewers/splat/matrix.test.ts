// ── 3DGS 相机/矩阵（纯函数直测） ──
// 钉住的是"约定"而不是实现细节：+x 右 / +y 下 / +z 前，可见点的相机空间 z > 0。

import { describe, expect, it } from "vitest";
import {
	cross,
	dot,
	focalForFov,
	length,
	normalize,
	orbitOffset,
	projectionMatrix,
	transformPoint,
	viewMatrix,
} from "./matrix.ts";

const UP_DOWN_WORLD = [0, -1, 0] as const;

/** -0 与 0 在数学上等价，但 toEqual 用 Object.is 区分，断言前统一成 0 */
const nz = (values: readonly number[]): number[] =>
	values.map((v) => (v === 0 ? 0 : v));

describe("viewMatrix", () => {
	it("相机在 -z 侧朝 +z 看时，目标点落在相机空间正 z 上（可见）", () => {
		const view = viewMatrix([0, 0, -5], [0, 0, 0], UP_DOWN_WORLD);
		const [x, y, z, w] = transformPoint(view, [0, 0, 0]);
		expect(nz([x, y, z, w])).toEqual([0, 0, 5, 1]);
		expect(z).toBeGreaterThan(0);
	});

	it("基向量符合 COLMAP 约定：右 = +x、屏幕上方 = -y、前 = +z", () => {
		const view = viewMatrix([0, 0, -5], [0, 0, 0], UP_DOWN_WORLD);
		// 列主序：[0..2] 为第一列 —— 三行分别是 right / up / forward
		expect(nz([view[0], view[4], view[8]])).toEqual([1, 0, 0]);
		expect(nz([view[1], view[5], view[9]])).toEqual([0, -1, 0]);
		expect(nz([view[2], view[6], view[10]])).toEqual([0, 0, 1]);
	});

	it("斜看时远处的点仍然可见（z 为正）", () => {
		const view = viewMatrix([3, 4, -6], [0, 0, 0], UP_DOWN_WORLD);
		expect(transformPoint(view, [0, 0, 0])[2]).toBeGreaterThan(0);
	});
});

describe("projectionMatrix", () => {
	it("w 分量等于相机空间 z（着色器据此做透视除法）", () => {
		const proj = projectionMatrix(500, 500, 1000, 800);
		const [, , , w] = transformPoint(proj, [1, 2, 12]);
		expect(w).toBeCloseTo(12, 5);
	});

	it("y 轴取负：世界的 y 朝下，屏幕上方向对应 -y", () => {
		const proj = projectionMatrix(500, 500, 1000, 800);
		const [, yDown] = transformPoint(proj, [0, 1, 10]);
		const [, yUp] = transformPoint(proj, [0, -1, 10]);
		expect(yDown).toBeLessThan(0); // 世界 y+（下）→ NDC 负（屏幕下方）
		expect(yUp).toBeGreaterThan(0);
	});

	it("视口中心投影到 NDC 原点（z 不参与 x/y）", () => {
		const proj = projectionMatrix(500, 500, 1000, 800);
		const [x, y] = transformPoint(proj, [0, 0, 7]);
		expect(x).toBe(0);
		expect(y).toBe(0);
	});
});

describe("focalForFov", () => {
	it("由竖直视场角得到像素焦距", () => {
		// 60° 视场、高 800 → f = 800 / (2·tan30°)
		expect(focalForFov(800, 60)).toBeCloseTo(
			800 / (2 * Math.tan(Math.PI / 6)),
			5,
		);
	});

	it("视场角越小焦距越大（画面越『长焦』）", () => {
		expect(focalForFov(800, 30)).toBeGreaterThan(focalForFov(800, 60));
	});
});

describe("orbitOffset", () => {
	it("初始位姿在 -z 侧", () => {
		const [x, y, z] = orbitOffset(5, 0, 0);
		expect(x).toBeCloseTo(0, 6);
		expect(y).toBeCloseTo(0, 6);
		expect(z).toBeCloseTo(-5, 6);
	});

	it("pitch 增大时相机抬高（世界 y 朝下，抬高是 -y）", () => {
		const [, y] = orbitOffset(5, 0, Math.PI / 2);
		expect(y).toBeCloseTo(-5, 6);
	});

	it("保持与目标的距离不变", () => {
		expect(length(orbitOffset(3, 1.1, 0.4))).toBeCloseTo(3, 6);
	});
});

describe("向量工具", () => {
	it("cross 与 dot 基本性质", () => {
		expect(nz(cross([0, 0, 1], [0, -1, 0]))).toEqual([1, 0, 0]);
		expect(dot([1, 2, 3], [0, 0, 0])).toBe(0);
	});

	it("normalize 零向量不产生 NaN", () => {
		expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
		expect(length(normalize([3, 4, 0]))).toBeCloseTo(1, 6);
	});
});
