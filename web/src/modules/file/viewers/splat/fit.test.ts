// ── 自动取景：把内容装进视口（纯函数直测） ──
//
// 断言用「独立实现」来做：把点按取景得到的相机与投影真投一遍，量 max|ndc| 的分位。
// fit.ts 里走的是一条闭式解（每个点算一个刚好装下它的距离，再取分位），
// 这里用 matrix.ts 的 viewMatrix/projectionMatrix 走完全不同的路径，两边必须吻合。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SplatBounds } from "../../lib/ply.ts";
import {
	boxCorners,
	cornerPoints,
	FIT_FILL,
	FIT_MASS,
	fitDistance,
	initialFraming,
	ORBIT_PIVOT_RATIO,
	SPLAT_FOV_DEG,
	WORLD_UP,
} from "./fit.ts";
import {
	focalForFov,
	projectionMatrix,
	transformPoint,
	type Vec3,
	type viewMatrix,
} from "./matrix.ts";

const bounds = (
	half: [number, number, number],
	center: [number, number, number] = [0, 0, 0],
): SplatBounds => ({ center, half, bboxRadius: Math.hypot(...half) });

/** 网格点集：在 half 的盒子里铺 n³ 个点（确定性，不用随机数） */
function gridPoints(half: Vec3, n: number): Float32Array {
	const out = new Float32Array(n * n * n * 3);
	let i = 0;
	for (let a = 0; a < n; a++) {
		for (let b = 0; b < n; b++) {
			for (let c = 0; c < n; c++) {
				out[i++] = ((a / (n - 1)) * 2 - 1) * half[0];
				out[i++] = ((b / (n - 1)) * 2 - 1) * half[1];
				out[i++] = ((c / (n - 1)) * 2 - 1) * half[2];
			}
		}
	}
	return out;
}

/** 把每个点的 max(|ndc.x|, |ndc.y|) 算出来（独立于 fit.ts 的路径） */
function ndcValues(
	points: ArrayLike<number>,
	viewport: { width: number; height: number },
	view: ReturnType<typeof viewMatrix>,
): number[] {
	const focal = focalForFov(viewport.height, SPLAT_FOV_DEG);
	const projection = projectionMatrix(
		focal,
		focal,
		viewport.width,
		viewport.height,
	);
	const values: number[] = [];
	for (let i = 0; i < Math.floor(points.length / 3); i++) {
		const world: Vec3 = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
		const cam = transformPoint(view, world);
		if (cam[2] <= 0.05) {
			values.push(Number.POSITIVE_INFINITY);
			continue;
		}
		const clip = transformPoint(projection, [cam[0], cam[1], cam[2]]);
		values.push(
			Math.max(Math.abs(clip[0] / clip[3]), Math.abs(clip[1] / clip[3])),
		);
	}
	return values.sort((a, b) => a - b);
}

const quantileOf = (sorted: number[], mass: number) =>
	sorted[
		Math.min(
			sorted.length - 1,
			Math.max(0, Math.ceil(mass * sorted.length) - 1),
		)
	];

/** 稠密核心 + 少量远端噪点：3DGS 场景的典型形状（浮点高斯散在外面） */
function coreWithFloaters(floaterCount: number) {
	const core = gridPoints([2, 2, 2], 12);
	const points = new Float32Array(core.length + floaterCount * 3);
	points.set(core);
	for (let i = 0; i < floaterCount; i++) {
		const sign = i % 2 === 0 ? 1 : -1;
		points[core.length + i * 3] = sign * 60;
		points[core.length + i * 3 + 1] = sign * 30;
		points[core.length + i * 3 + 2] = -sign * 45;
	}
	return points;
}

describe("fitDistance（按包围盒角点，mass = 1）", () => {
	const corners = (b: SplatBounds) => cornerPoints(b);

	it("受限的那一维总是贴到目标比例，另一维不越界", () => {
		// 1280×558 ≈ 详情页左栏。各向同性内容在这种宽扁视口里由纵向决定距离
		// （横向 FOV 随宽高比变宽，反而宽松）
		const viewport = { width: 1280, height: 558 };
		const b = bounds([10, 10, 10]);
		const distance = fitDistance(corners(b), b.center, viewport, 0);
		const { view } = initialFraming(b, viewport, 0);
		const values = ndcValues(corners(b), viewport, view);
		expect(distance).toBeGreaterThan(10);
		expect(values[values.length - 1]).toBeCloseTo(FIT_FILL, 3);
	});

	it("扁而长的场景装到接近满幅，而不是退成中间一条", () => {
		// 复刻实测那个 106MB 场景的比例：x ±28、y ±7、z ±35。
		// 旧公式（2.5 × 距离 P90）与屏幕伸展无关，同一内容会算得太远
		const viewport = { width: 1280, height: 558 };
		const b = bounds([28, 7, 35]);
		const { view } = initialFraming(b, viewport, 0);
		const values = ndcValues(corners(b), viewport, view);
		expect(values[values.length - 1]).toBeCloseTo(FIT_FILL, 2);
	});

	it("窄高视口里改为横向受限（宽高比小于 1）", () => {
		const viewport = { width: 400, height: 900 };
		const b = bounds([10, 10, 10]);
		const { view } = initialFraming(b, viewport, 0);
		const values = ndcValues(corners(b), viewport, view);
		expect(values[values.length - 1]).toBeCloseTo(FIT_FILL, 3);
	});

	it("俯仰算进纵向范围：斜看时角点同样不越界", () => {
		const viewport = { width: 800, height: 600 };
		const b = bounds([20, 4, 30]);
		const pitch = 0.6; // 大幅俯视，纵向范围会混入深度
		const { view } = initialFraming(b, viewport, pitch);
		const values = ndcValues(corners(b), viewport, view);
		expect(values[values.length - 1]).toBeCloseTo(FIT_FILL, 3);
	});

	it("宽视口可以让同样内容更近，但不会更远", () => {
		// 宽扁内容（半宽 30、半高 5）在宽视口里由横向决定距离；方视口横向收紧
		const wide = fitDistance(cornerPoints(bounds([30, 5, 5])), [0, 0, 0], {
			width: 1600,
			height: 600,
		});
		const square = fitDistance(cornerPoints(bounds([30, 5, 5])), [0, 0, 0], {
			width: 600,
			height: 600,
		});
		expect(wide).toBeLessThan(square);
	});

	it("只跟内容相对中心的形状有关，与它落在世界坐标哪里无关", () => {
		const viewport = { width: 800, height: 600 };
		const atOrigin = fitDistance(
			cornerPoints(bounds([20, 4, 30])),
			[0, 0, 0],
			viewport,
			0.2,
		);
		// 地理配准的点云会把内容放在几十万量级上（UTM），取景不能被绝对坐标影响
		const farAway = fitDistance(
			cornerPoints(bounds([20, 4, 30], [500_000, -1200, 8000])),
			[500_000, -1200, 8000],
			viewport,
			0.2,
		);
		expect(farAway).toBeCloseTo(atOrigin, 2);
	});

	it("退化内容（所有点重合）给一个正的距离，不会算出 0 或 Infinity", () => {
		const distance = fitDistance(cornerPoints(bounds([0, 0, 0])), [0, 0, 0], {
			width: 800,
			height: 600,
		});
		expect(Number.isFinite(distance)).toBe(true);
		expect(distance).toBeGreaterThan(0);
	});

	it("视口尺寸为 0（未挂载 / jsdom）时退回兜底宽高比", () => {
		const distance = fitDistance(
			cornerPoints(bounds([10, 10, 10])),
			[0, 0, 0],
			{ width: 0, height: 0 },
		);
		expect(Number.isFinite(distance)).toBe(true);
		expect(distance).toBeGreaterThan(10);
	});

	it("空点集不炸，给一个正的兜底距离", () => {
		const distance = fitDistance(new Float32Array(0), [0, 0, 0], {
			width: 800,
			height: 600,
		});
		expect(Number.isFinite(distance)).toBe(true);
		expect(distance).toBeGreaterThan(0);
	});
});

describe("fitDistance（按顶点样本，允许尾部出画）", () => {
	it("少量远端噪点被允许出画，取景因此近得多——这就是「填满」的关键", () => {
		// 1728 个点铺在 ±2 内 + 4 个点在 60 开外：噪点占比 0.23% < 1 - FIT_MASS
		const points = coreWithFloaters(4);
		const viewport = { width: 1280, height: 558 };
		const boxFit = initialFraming(bounds([60, 60, 60]), viewport, 0);
		const sampleFit = initialFraming(bounds([60, 60, 60]), viewport, 0, points);

		// 按盒取景被噪点拽远；按点的分布取景不受影响
		expect(sampleFit.distance).toBeLessThan(boxFit.distance * 0.5);

		const values = ndcValues(points, viewport, sampleFit.view);
		// 出画的比例不超过允许的尾部（这里只有那几个噪点）
		expect(values.filter((v) => v > 1).length / values.length).toBeLessThan(
			0.01,
		);
		// 受限的那一维确实被填满（而不是"中间一条"）
		expect(quantileOf(values, FIT_MASS)).toBeCloseTo(FIT_FILL, 2);
		// 对照：按盒取景时同样的点只占画面一小块
		const boxValues = ndcValues(points, viewport, boxFit.view);
		expect(quantileOf(boxValues, FIT_MASS)).toBeLessThan(FIT_FILL * 0.5);
	});

	it("绝大多数点装进画面，只有允许的尾部出画", () => {
		const points = gridPoints([30, 8, 20], 10);
		const viewport = { width: 1280, height: 558 };
		const framing = initialFraming(bounds([30, 8, 20]), viewport, 0.15, points);
		const values = ndcValues(points, viewport, framing.view);
		expect(quantileOf(values, FIT_MASS)).toBeLessThanOrEqual(FIT_FILL + 1e-6);
		expect(values.filter((v) => v > 1).length / values.length).toBeLessThan(
			1 - FIT_MASS + 0.005,
		);
	});
});

describe("initialFraming", () => {
	it("看向包围盒中心，距离等于环绕半径", () => {
		const center: [number, number, number] = [5, -3, 2];
		const b = bounds([4, 4, 4], center);
		const framing = initialFraming(b, { width: 800, height: 600 }, 0.15);
		// 视图矩阵的平移部分 = -R·eye；用它还原机位，验证相机确实在「中心 + 距离 × 方向」上
		const view = framing.view;
		const eye = [
			-(view[0] * view[12] + view[1] * view[13] + view[2] * view[14]),
			-(view[4] * view[12] + view[5] * view[13] + view[6] * view[14]),
			-(view[8] * view[12] + view[9] * view[13] + view[10] * view[14]),
		];
		const distance = Math.hypot(
			eye[0] - center[0],
			eye[1] - center[1],
			eye[2] - center[2],
		);
		expect(distance).toBeCloseTo(framing.distance, 3);
		// 俯仰为正时相机在世界 y 的上方（3DGS 的 y 轴朝下，所以是负 y 方向）
		expect(eye[1]).toBeLessThan(center[1]);
		// 相机在 -z 一侧看向 +z（COLMAP 约定）
		expect(eye[2]).toBeLessThan(center[2]);
	});

	it("给了顶点样本就按样本取景，没给才退回包围盒角点", () => {
		const viewport = { width: 1280, height: 558 };
		const b = bounds([60, 60, 60]);
		const points = coreWithFloaters(4);
		const byBox = initialFraming(b, viewport, 0);
		const bySample = initialFraming(b, viewport, 0, points);
		expect(bySample.distance).toBeLessThan(byBox.distance);
		// 样本为空数组时也不能把相机怼到内容里
		const empty = initialFraming(b, viewport, 0, new Float32Array(0));
		expect(empty.distance).toBeCloseTo(byBox.distance, 6);
	});

	it("相机不会落在内容内部", () => {
		const framing = initialFraming(bounds([10, 10, 10]), {
			width: 800,
			height: 600,
		});
		expect(framing.distance).toBeGreaterThan(10);
	});
});

describe("初始取景的方向与环绕定点", () => {
	// 本文件其他断言量的都是 max(|ndc.x|, |ndc.y|) —— 画面上下颠倒也照样通过，
	// 所以"哪一侧在上"必须单独钉住。曾经 viewMatrix 的第二行放的是"屏幕上方"，
	// 取景距离完全正确、画面却整体上下颠倒（俯视看着像仰视），就是这么漏过去的。
	const viewport = { width: 1280, height: 558 };

	/** 世界点 → NDC y（> 0 = 屏幕上半） */
	const ndcY = (view: ReturnType<typeof viewMatrix>, world: Vec3) => {
		const focal = focalForFov(viewport.height, SPLAT_FOV_DEG);
		const proj = projectionMatrix(
			focal,
			focal,
			viewport.width,
			viewport.height,
		);
		const cam = transformPoint(view, world);
		const clip = transformPoint(proj, [cam[0], cam[1], cam[2]]);
		return clip[1] / clip[3];
	};

	it("世界「朝上」的方向出现在画面上半屏", () => {
		const { view } = initialFraming(bounds([10, 6, 8]), viewport, 0.15);
		// 3DGS 的数据 y 轴朝下：中心上方（-y）的点要在上半屏，下方（+y）在下半屏
		expect(ndcY(view, [0, -4, 0])).toBeGreaterThan(0);
		expect(ndcY(view, [0, 4, 0])).toBeLessThan(0);
	});

	it("环绕定点按初始距离等比缩放（对齐参考实现的 4 / 6.55）", () => {
		const framing = initialFraming(bounds([10, 6, 8]), viewport, 0.15);
		expect(ORBIT_PIVOT_RATIO).toBeCloseTo(4 / 6.55, 6);
		expect(framing.pivot).toBeCloseTo(framing.distance * ORBIT_PIVOT_RATIO, 6);
		// 定点落在相机与内容中心之间（参考实现也是 4 < 6.55），不是正好在中心上 ——
		// 定点越远，同样拖拽幅度下相机平移得越多、越不像"原地转"
		expect(framing.pivot).toBeLessThan(framing.distance);
		expect(framing.pivot / framing.distance).toBeCloseTo(0.61, 2);
	});
});

describe("与渲染器共用同一个视场角", () => {
	it("FOV 只有一个来源：renderer 从 fit 取，不自己再写一份", () => {
		// 两边各写一个 55 的话，取景按一个值算、投影按另一个值画，画面就永远差一截
		const source = readFileSync(
			resolve(process.cwd(), "src/modules/file/viewers/splat/renderer.ts"),
			"utf8",
		);
		expect(source).toContain("SPLAT_FOV_DEG");
		expect(source).not.toMatch(/const\s+FOV_DEG\s*=/);
	});
});

describe("boxCorners / cornerPoints", () => {
	it("给出 8 个互不相同的角，cornerPoints 带上中心偏移", () => {
		const corners = boxCorners([1, 2, 3]);
		expect(corners.length).toBe(8);
		expect(new Set(corners.map((c) => c.join(","))).size).toBe(8);
		const points = cornerPoints(bounds([1, 1, 1], [10, 20, 30]));
		expect(points.length).toBe(24);
		expect(points[0]).toBeCloseTo(9, 6);
		expect(points[1]).toBeCloseTo(19, 6);
		expect(points[2]).toBeCloseTo(29, 6);
		expect(WORLD_UP).toEqual([0, -1, 0]);
	});
});
