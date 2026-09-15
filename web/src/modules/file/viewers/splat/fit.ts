// ── 自动取景：把内容装进当前视口（纯函数，可直测） ──
//
// 之前的做法是 `距离 = 2.5 × P90 半径`，那个"半径"是各点到中心的**距离分位数**，
// 与内容在屏幕上占多大没有关系，实测两个真实场景各偏一个方向：
//   · 8MB 场景（点分布在"壳"上，径向距离小、屏幕伸展大）→ 偏近，溢出的点被裁掉
//   · 106MB 场景（y 只有 ±14 而 x/z 是 ±56/±70，扁而长）→ 偏偏远，
//     在 2.3:1 的预览区里点在屏幕上的 95 分位只有 0.41（半幅），看着就是"中间一条"
//
// 现在的做法：直接按**点的投影分布**求距离。相机只做俯仰（绕 x 轴），于是对每个点有
//   cam.x = p.x - center.x          （与距离无关）
//   cam.y = (p - center)·up         （与距离无关）
//   cam.z = (p - center)·forward + d（随距离线性增长）
// 要让该点落进画面，只需 `d ≥ max(A|cam.x|, B|cam.y|) / fill - cam.z₀`（A、B 是焦距项），
// 所以每个点都有一个"刚好装下它"的距离，取这些距离的 `mass` 分位就是答案 ——
// 一遍 O(N) 加一次分位，不用二分搜索，也不受"包围盒空角"的影响。
//
// 分位 `mass`：取样本点（顶点的等间隔抽样）时用 0.99 —— 实测两个真实场景下，
// 这个分位让点在屏幕上的 99 分位恰好落在画框边缘、出画不到 1%，而内容比
// 「距离 P90 × 2.5」大 1.36~1.5 倍（那正是"只占中间一小块"的观感来源）。
// 没有样本点时退回包围盒的 8 个角，等价于要求整个盒子装进画面（mass = 1）。
//
// 参考实现（antimatter15/splat）不做自动取景：它的相机内参与初始机位是给它自己那几个
// demo 场景写死的（`camera.fx ≈ 1160`、`defaultViewMatrix` 平移 6.55）。用户传上来的
// 任意 .ply 没有可用的内参，只能从内容本身推距离 —— FOV、投影、混合等仍与它一致。

import type { SplatBounds } from "../../lib/ply.ts";
import {
	add,
	focalForFov,
	type Mat4,
	orbitOffset,
	type Vec3,
	viewMatrix,
} from "./matrix.ts";

/** 竖直视场角（度）：取景与渲染共用这一个值，两边各写一份迟早会漂移 */
export const SPLAT_FOV_DEG = 55;

/** 世界坐标的"画面上方"：3DGS / COLMAP 的 y 轴朝下 */
export const WORLD_UP: Vec3 = [0, -1, 0];

/** 内容占画面"受限那一维"的比例；留一点边距，贴边看着局促 */
export const FIT_FILL = 0.92;

/** 取样本点时的分位：允许 1% 的离群高斯出画，换内容更满 */
export const FIT_MASS = 0.99;

/** 相机到最近内容的余量：比这更近，投影会翻到相机背后 */
const NEAR_MARGIN = 0.05;

/** 视口尺寸为 0（未挂载 / jsdom）时的兜底宽高比 */
const FALLBACK_ASPECT = 16 / 9;

export interface Viewport {
	width: number;
	height: number;
}

export interface Framing {
	/** 初始视图矩阵（世界 → 相机） */
	view: Mat4;
	/** 相机到目标点的距离，也就是环绕半径 */
	distance: number;
}

/** 包围盒 8 个角（相对中心） */
export function boxCorners(half: Vec3): Vec3[] {
	const corners: Vec3[] = [];
	for (const sx of [-1, 1]) {
		for (const sy of [-1, 1]) {
			for (const sz of [-1, 1]) {
				corners.push([sx * half[0], sy * half[1], sz * half[2]]);
			}
		}
	}
	return corners;
}

/** 包围盒 8 个角的世界坐标（扁平 xyz）：没有顶点样本时的取景目标 */
export function cornerPoints(bounds: SplatBounds): Float32Array {
	const out = new Float32Array(8 * 3);
	boxCorners(bounds.half).forEach((corner, i) => {
		for (let axis = 0; axis < 3; axis++) {
			out[i * 3 + axis] = bounds.center[axis] + corner[axis];
		}
	});
	return out;
}

/**
 * 视口尺寸兜底：宽或高为 0（未挂载、隐藏、jsdom 没有布局）时按 16:9 补齐。
 * 绝对尺寸无所谓 —— 焦距由高推出、投影按宽高比算，取景只用得到两者的比例。
 */
function normalized(viewport: Viewport): Viewport {
	const { width, height } = viewport;
	if (width > 0 && height > 0) return { width, height };
	if (width <= 0 && height <= 0) return { width: FALLBACK_ASPECT, height: 1 };
	return width <= 0
		? { width: height * FALLBACK_ASPECT, height }
		: { width, height: width / FALLBACK_ASPECT };
}

/** 分位数（就地排序取第 k 个，取景只在极少数时机调用，不值当上 quickselect） */
function quantile(values: Float64Array, mass: number): number {
	if (values.length === 0) return NEAR_MARGIN;
	const sorted = Array.from(values).sort((a, b) => a - b);
	const clamped = Math.min(1, Math.max(0, mass));
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(clamped * sorted.length) - 1),
	);
	return sorted[index];
}

/**
 * 让 `points` 中 `mass` 比例的点装进画面所需的最小相机距离。
 *
 * `points` 是扁平 xyz（世界坐标）；相机在 `center` 前方 `pitch` 角度上看向中心。
 * 要装"整个包围盒"就传 8 个角点并取 `mass = 1`；要装"点云本体"就传顶点样本并取
 * 略小于 1 的分位（见 `FIT_MASS`）。
 */
export function fitDistance(
	points: ArrayLike<number>,
	center: Vec3,
	viewport: Viewport,
	pitch = 0,
	fill = FIT_FILL,
	mass = 1,
): number {
	const count = Math.floor(points.length / 3);
	if (count === 0) return NEAR_MARGIN;
	const { width, height } = normalized(viewport);
	const focal = focalForFov(height, SPLAT_FOV_DEG);
	// |ndc| = A·|cam|/cam.z 中的系数：A = 2f/宽，B = 2f/高
	const ax = (2 * focal) / width / fill;
	const ay = (2 * focal) / height / fill;

	// forward = -dir（相机朝向中心），up 由 right×forward 给出；pitch 只绕 x 轴，
	// 所以 cam.x、cam.y 与距离无关，只有沿 forward 的分量随距离平移。
	const dir = orbitOffset(1, 0, pitch);
	const forward: Vec3 = [-dir[0], -dir[1], -dir[2]];
	const right: Vec3 = [forward[2], 0, -forward[0]];
	const rightLen = Math.hypot(right[0], right[1], right[2]) || 1;
	const r: Vec3 = [
		right[0] / rightLen,
		right[1] / rightLen,
		right[2] / rightLen,
	];
	const u: Vec3 = [
		r[1] * forward[2] - r[2] * forward[1],
		r[2] * forward[0] - r[0] * forward[2],
		r[0] * forward[1] - r[1] * forward[0],
	];

	const needed = new Float64Array(count);
	for (let i = 0; i < count; i++) {
		const dx = points[i * 3] - center[0];
		const dy = points[i * 3 + 1] - center[1];
		const dz = points[i * 3 + 2] - center[2];
		const camX = dx * r[0] + dy * r[1] + dz * r[2];
		const camY = dx * u[0] + dy * u[1] + dz * u[2];
		// 纵深分量（不含距离本身），以及把该点推入画面所需的总距离
		const camZ0 = dx * forward[0] + dy * forward[1] + dz * forward[2];
		needed[i] =
			Math.max(ax * Math.abs(camX), ay * Math.abs(camY), NEAR_MARGIN) - camZ0;
	}
	return Math.max(quantile(needed, mass), NEAR_MARGIN);
}

/**
 * 初始取景：相机拉到"刚好装下内容"的距离，看向包围盒中心。
 *
 * 传了顶点样本就按点的分布取景（推荐，见文件头注释）；没有样本则退回包围盒的 8 个角。
 */
export function initialFraming(
	bounds: SplatBounds,
	viewport: Viewport,
	pitch = 0,
	sample?: ArrayLike<number>,
	fill = FIT_FILL,
): Framing {
	const hasSample = sample !== undefined && sample.length >= 3;
	const distance = hasSample
		? fitDistance(sample, bounds.center, viewport, pitch, fill, FIT_MASS)
		: fitDistance(
				cornerPoints(bounds),
				bounds.center,
				viewport,
				pitch,
				fill,
				1,
			);
	const eye = add(bounds.center, orbitOffset(distance, 0, pitch));
	return { view: viewMatrix(eye, bounds.center, WORLD_UP), distance };
}
