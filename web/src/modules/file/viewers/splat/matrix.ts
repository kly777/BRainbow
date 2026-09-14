// ── 3DGS 视图所需的向量/矩阵工具（纯函数，列主序，可直测） ──
//
// 相机约定与 3DGS / COLMAP 一致：**+x 右、+y 下、+z 前**，可见点的相机空间 z > 0。
// 着色器按这个约定做投影（见 shaders.ts），所以这里不能换成 OpenGL 默认的"看向 -z"。

export type Vec3 = readonly [number, number, number];

/** 列主序 4×4，可直接交给 gl.uniformMatrix4fv(loc, false, m) */
export type Mat4 = Float32Array;

export function sub(a: Vec3, b: Vec3): Vec3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a: Vec3, b: Vec3): Vec3 {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scaleVec(a: Vec3, k: number): Vec3 {
	return [a[0] * k, a[1] * k, a[2] * k];
}

export function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
}

export function normalize(a: Vec3): Vec3 {
	const len = Math.hypot(a[0], a[1], a[2]);
	return len === 0 ? [0, 0, 0] : [a[0] / len, a[1] / len, a[2] / len];
}

export function length(a: Vec3): number {
	return Math.hypot(a[0], a[1], a[2]);
}

/**
 * 世界 → 相机的视图矩阵。
 * `up` 传世界坐标里的"画面上方"（3DGS 的 y 轴朝下，所以是 (0,-1,0)）。
 */
export function viewMatrix(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
	const forward = normalize(sub(target, eye));
	const right = normalize(cross(forward, up));
	const u = cross(right, forward);
	return new Float32Array([
		right[0],
		u[0],
		forward[0],
		0,
		right[1],
		u[1],
		forward[1],
		0,
		right[2],
		u[2],
		forward[2],
		0,
		-dot(right, eye),
		-dot(u, eye),
		-dot(forward, eye),
		1,
	]);
}

export const DEFAULT_NEAR = 0.2;
export const DEFAULT_FAR = 500;

/**
 * 投影矩阵。与参考实现同构：`w = 相机空间 z`（着色器据此做透视除法），
 * y 轴取负——这样"世界的 y 朝下"渲染出来才是正的。
 */
export function projectionMatrix(
	fx: number,
	fy: number,
	width: number,
	height: number,
	znear = DEFAULT_NEAR,
	zfar = DEFAULT_FAR,
): Mat4 {
	const a = zfar / (zfar - znear);
	const b = -(zfar * znear) / (zfar - znear);
	return new Float32Array([
		(2 * fx) / width,
		0,
		0,
		0,
		0,
		(-2 * fy) / height,
		0,
		0,
		0,
		0,
		a,
		1,
		0,
		0,
		b,
		0,
	]);
}

/** 竖直视场角（度）→ 焦距（像素，与视口像素同单位） */
export function focalForFov(viewportHeight: number, fovDeg: number): number {
	const halfFov = (fovDeg * Math.PI) / 360;
	return viewportHeight / (2 * Math.tan(halfFov));
}

/**
 * 轨道相机的机位偏移（相对目标点）。
 * `yaw` 绕世界 y 轴、`pitch` 取值越大越"高"（世界 y 朝下，所以是 -y 方向）。
 */
export function orbitOffset(
	distance: number,
	yaw: number,
	pitch: number,
): Vec3 {
	const cp = Math.cos(pitch);
	return [
		distance * cp * Math.sin(yaw),
		-distance * Math.sin(pitch),
		-distance * cp * Math.cos(yaw),
	];
}

/** 把点用矩阵变换一下（测试与取景计算用） */
export function transformPoint(
	m: Mat4,
	p: Vec3,
): [number, number, number, number] {
	return [
		m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
		m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
		m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
		m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
	];
}
