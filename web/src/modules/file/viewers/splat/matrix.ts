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

// ── 相机自身的变换 ──
//
// 下面四个函数照搬 antimatter15/splat（MIT License, Copyright (c) 2023 Kevin Kwok）
// https://github.com/antimatter15/splat —— 键盘/鼠标操作全部在这套语义上做增量：
// translate 与 rotate 都是**左乘在逆矩阵上**（即相机自身坐标系里的变换），
// 所以箭头键的 +z 就是"向前"，旋转轴也是相机自己的轴。

/** 矩阵乘法（列主序，结果 = a · b） */
export function multiply4(a: Mat4, b: Mat4): Mat4 {
	const out = new Float32Array(16);
	for (let col = 0; col < 4; col++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
			out[col * 4 + row] = sum;
		}
	}
	return out;
}

/** 逆矩阵；奇异矩阵（行列式为 0）返回 undefined */
export function invert4(a: Mat4): Mat4 | undefined {
	const b00 = a[0] * a[5] - a[1] * a[4];
	const b01 = a[0] * a[6] - a[2] * a[4];
	const b02 = a[0] * a[7] - a[3] * a[4];
	const b03 = a[1] * a[6] - a[2] * a[5];
	const b04 = a[1] * a[7] - a[3] * a[5];
	const b05 = a[2] * a[7] - a[3] * a[6];
	const b06 = a[8] * a[13] - a[9] * a[12];
	const b07 = a[8] * a[14] - a[10] * a[12];
	const b08 = a[8] * a[15] - a[11] * a[12];
	const b09 = a[9] * a[14] - a[10] * a[13];
	const b10 = a[9] * a[15] - a[11] * a[13];
	const b11 = a[10] * a[15] - a[11] * a[14];
	const det =
		b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
	if (!det) return undefined;
	return new Float32Array([
		(a[5] * b11 - a[6] * b10 + a[7] * b09) / det,
		(a[2] * b10 - a[1] * b11 - a[3] * b09) / det,
		(a[13] * b05 - a[14] * b04 + a[15] * b03) / det,
		(a[10] * b04 - a[9] * b05 - a[11] * b03) / det,
		(a[6] * b08 - a[4] * b11 - a[7] * b07) / det,
		(a[0] * b11 - a[2] * b08 + a[3] * b07) / det,
		(a[14] * b02 - a[12] * b05 - a[15] * b01) / det,
		(a[8] * b05 - a[10] * b02 + a[11] * b01) / det,
		(a[4] * b10 - a[5] * b08 + a[7] * b06) / det,
		(a[1] * b08 - a[0] * b10 - a[3] * b06) / det,
		(a[12] * b04 - a[13] * b02 + a[15] * b00) / det,
		(a[9] * b02 - a[8] * b04 - a[11] * b00) / det,
		(a[5] * b07 - a[4] * b09 - a[6] * b06) / det,
		(a[0] * b09 - a[1] * b07 + a[2] * b06) / det,
		(a[13] * b01 - a[12] * b03 - a[14] * b00) / det,
		(a[8] * b03 - a[9] * b01 + a[10] * b00) / det,
	]);
}

/** 绕相机自身坐标系的轴 (x,y,z) 旋转 rad 弧度 */
export function rotate4(
	a: Mat4,
	rad: number,
	x: number,
	y: number,
	z: number,
): Mat4 {
	const len = Math.hypot(x, y, z);
	x /= len;
	y /= len;
	z /= len;
	const s = Math.sin(rad);
	const c = Math.cos(rad);
	const t = 1 - c;
	const b00 = x * x * t + c;
	const b01 = y * x * t + z * s;
	const b02 = z * x * t - y * s;
	const b10 = x * y * t - z * s;
	const b11 = y * y * t + c;
	const b12 = z * y * t + x * s;
	const b20 = x * z * t + y * s;
	const b21 = y * z * t - x * s;
	const b22 = z * z * t + c;
	return new Float32Array([
		a[0] * b00 + a[4] * b01 + a[8] * b02,
		a[1] * b00 + a[5] * b01 + a[9] * b02,
		a[2] * b00 + a[6] * b01 + a[10] * b02,
		a[3] * b00 + a[7] * b01 + a[11] * b02,
		a[0] * b10 + a[4] * b11 + a[8] * b12,
		a[1] * b10 + a[5] * b11 + a[9] * b12,
		a[2] * b10 + a[6] * b11 + a[10] * b12,
		a[3] * b10 + a[7] * b11 + a[11] * b12,
		a[0] * b20 + a[4] * b21 + a[8] * b22,
		a[1] * b20 + a[5] * b21 + a[9] * b22,
		a[2] * b20 + a[6] * b21 + a[10] * b22,
		a[3] * b20 + a[7] * b21 + a[11] * b22,
		...a.slice(12, 16),
	]);
}

/** 沿相机自身坐标系的轴平移 */
export function translate4(a: Mat4, x: number, y: number, z: number): Mat4 {
	return new Float32Array([
		...a.slice(0, 12),
		a[0] * x + a[4] * y + a[8] * z + a[12],
		a[1] * x + a[5] * y + a[9] * z + a[13],
		a[2] * x + a[6] * y + a[10] * z + a[14],
		a[3] * x + a[7] * y + a[11] * z + a[15],
	]);
}
