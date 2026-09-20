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

	it("三行分别是 右 / 屏幕向下 / 前（第二行是 +y，不是 -y）", () => {
		const view = viewMatrix([0, 0, -5], [0, 0, 0], UP_DOWN_WORLD);
		// 列主序：[0]、[4]、[8] 是各行第一列
		expect(nz([view[0], view[4], view[8]])).toEqual([1, 0, 0]);
		// 世界 y 朝下 → 屏幕向下就是世界 +y。第二行放 -y 会让整个画面上下颠倒
		// （俯视看着像仰视），曾经就是错的
		expect(nz([view[1], view[5], view[9]])).toEqual([0, 1, 0]);
		expect(nz([view[2], view[6], view[10]])).toEqual([0, 0, 1]);
	});

	it("世界「朝上」的方向落在画面上半屏（上下颠倒过的回归）", () => {
		const viewport = { width: 1000, height: 800 };
		const focal = focalForFov(viewport.height, 60);
		const proj = projectionMatrix(
			focal,
			focal,
			viewport.width,
			viewport.height,
		);
		const view = viewMatrix([0, 0, -5], [0, 0, 0], UP_DOWN_WORLD);
		/** 世界点 → NDC y（> 0 = 屏幕上半） */
		const ndcY = (world: [number, number, number]) => {
			const cam = transformPoint(view, world);
			const clip = transformPoint(proj, [cam[0], cam[1], cam[2]]);
			return clip[1] / clip[3];
		};
		// 3DGS 的数据里 y 朝下，所以"上方"是 -y
		expect(ndcY([0, -1, 0])).toBeGreaterThan(0);
		expect(ndcY([0, 1, 0])).toBeLessThan(0);
	});

	it("斜看时远处的点仍然可见（z 为正）", () => {
		const view = viewMatrix([3, 4, -6], [0, 0, 0], UP_DOWN_WORLD);
		expect(transformPoint(view, [0, 0, 0])[2]).toBeGreaterThan(0);
	});
});

// 参考实现 antimatter15/splat 的默认机位与内参（main.js:734 的 `defaultViewMatrix`
// 与 cameras[0] 的 fx/fy ≈ 1160，视口用它的截图尺寸 1959×1090）。它没有任何"翻转"
// 代码，却能把 3DGS 场景渲染正立 —— 于是它的相机基就是这套数据约定的权威答案：
// 第二行（屏幕向下）≈ 世界 +y。本文件此前第二行放的是 -y（"屏幕上方"），画面于是
// 上下颠倒，旧测试断言 [0, -1, 0] 反倒把这个错固化了下来。
// 这里直接拿参考实现的数字交叉验证，防止再翻回去。
const REFERENCE_VIEW = new Float32Array([
	0.47, 0.04, 0.88, 0, -0.11, 0.99, 0.02, 0, -0.88, -0.11, 0.47, 0, 0.07, 0.03,
	6.55, 1,
]);
const REFERENCE_FOCAL = 1160;
const REFERENCE_VIEWPORT = { width: 1959, height: 1090 };

const ndcOf = (view: Float32Array, world: [number, number, number]) => {
	// 着色器的两个矩阵都是列主序上传的，这里同样直接当列主序用
	const proj = projectionMatrix(
		REFERENCE_FOCAL,
		REFERENCE_FOCAL,
		REFERENCE_VIEWPORT.width,
		REFERENCE_VIEWPORT.height,
	);
	const cam = transformPoint(view, world);
	const clip = transformPoint(proj, [cam[0], cam[1], cam[2]]);
	return { camZ: cam[2], y: clip[1] / clip[3] };
};

describe("与参考实现的相机基一致", () => {
	it("参考实现：世界 +y（数据里的「下」）落在下半屏", () => {
		const { camZ, y } = ndcOf(REFERENCE_VIEW, [0, 1, 0]);
		expect(camZ).toBeGreaterThan(0); // 在相机前方（可见区）
		expect(y).toBeLessThan(0); // NDC y < 0 = 屏幕下半
		// 第二行就是"屏幕向下"轴：它指向世界 +y，这就是"数据 y 轴朝下"的原始依据
		const rowDown = [REFERENCE_VIEW[1], REFERENCE_VIEW[5], REFERENCE_VIEW[9]];
		expect(rowDown[1]).toBeGreaterThan(0.9);
	});

	it("本文件的 viewMatrix 给出同一个方向", () => {
		// 等价位姿：相机在 -z 侧看向原点、世界 -y 朝上（参考实现的默认机位也近乎水平）
		const view = viewMatrix([0, 0, -6.55], [0, 0, 0], UP_DOWN_WORLD);
		expect(ndcOf(view, [0, 1, 0]).y).toBeLessThan(0);
		expect(ndcOf(view, [0, -1, 0]).y).toBeGreaterThan(0);
	});

	it("俯仰不为 0 时方向不变（初始取景就是俯视机位）", () => {
		const view = viewMatrix([0, -1.2, -6.4], [0, 0, 0], UP_DOWN_WORLD);
		expect(ndcOf(view, [0, 1, 0]).y).toBeLessThan(0);
		expect(ndcOf(view, [0, -1, 0]).y).toBeGreaterThan(0);
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
