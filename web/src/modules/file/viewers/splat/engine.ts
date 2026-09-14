// ── 泼溅引擎：解析 → 纹理打包 → 按深度排序（无 DOM / 无 WebGL / 无 worker 依赖） ──
//
// 单独抽出来是为了可测：worker.ts 只是它的通信适配层。
// 排序与纹理打包算法取自 antimatter15/splat（MIT License, Copyright (c) 2023 Kevin Kwok）
// https://github.com/antimatter15/splat —— 数学与阈值未改动，数据结构换成显式类型。

import {
	buildSplatData,
	buildSplatTexture,
	type SplatBounds,
} from "../../lib/ply.ts";

/** 纹理宽度：1024×2，与参考实现一致（着色器寻址常量 0x3ff 依赖它） */
export const TEX_WIDTH = 1024 * 2;

export interface LoadedSplat {
	vertexCount: number;
	bounds: SplatBounds;
	/** 普通点云（无高斯参数） */
	pointCloud: boolean;
	/** 顶点纹理数据（RGBA32UI，每顶点两个 texel） */
	texdata: Uint32Array;
	texWidth: number;
	texHeight: number;
	/** 初始顺序（按 importance，先能看） */
	depthIndex: Uint32Array;
}

export interface SplatEngine {
	/** 解析一份 PLY 字节；不可解析时抛 PlyError（调用方负责转成用户可读的提示） */
	load(bytes: Uint8Array): LoadedSplat;
	/** 按深度轴重排；视角几乎没变时返回 undefined（调用方可跳过上传索引） */
	sort(axis: readonly [number, number, number]): Uint32Array | undefined;
	readonly vertexCount: number;
}

export function createSplatEngine(): SplatEngine {
	let splatBytes: Uint8Array | undefined;
	let vertexCount = 0;
	let depthIndex = new Uint32Array();
	/** 上次排序用的轴，用来跳过"视角没怎么变"的重复排序 */
	let lastAxis: [number, number, number] | undefined;

	function load(bytes: Uint8Array): LoadedSplat {
		const data = buildSplatData(bytes);
		const { texdata, texHeight } = buildSplatTexture(data, TEX_WIDTH);
		splatBytes = data.bytes;
		vertexCount = data.vertexCount;
		lastAxis = undefined;
		depthIndex = new Uint32Array(vertexCount);
		for (let i = 0; i < vertexCount; i++) depthIndex[i] = i;
		return {
			vertexCount,
			bounds: data.bounds,
			pointCloud: data.pointCloud,
			texdata,
			texWidth: TEX_WIDTH,
			texHeight,
			depthIndex,
		};
	}

	/**
	 * 16 位单遍计数排序（按深度分桶）。顶点数上到几十万时比比较排序快一个量级，
	 * 也是参考实现唯一用的排序方式。
	 */
	function sort(
		axis: readonly [number, number, number],
	): Uint32Array | undefined {
		if (!splatBytes || vertexCount === 0) return undefined;
		const [ax, ay, az] = axis;
		if (lastAxis) {
			// 前向轴几乎没变就不重排（阈值同参考实现）
			const dot = lastAxis[0] * ax + lastAxis[1] * ay + lastAxis[2] * az;
			if (Math.abs(dot - 1) < 0.001) return undefined;
		}

		// 紧凑数组每顶点 8 个 f32：位置 3 + 缩放 3 + 颜色/旋转各 1
		const f = new Float32Array(
			splatBytes.buffer,
			splatBytes.byteOffset,
			vertexCount * 8,
		);
		let maxDepth = Number.NEGATIVE_INFINITY;
		let minDepth = Number.POSITIVE_INFINITY;
		const quantized = new Int32Array(vertexCount);
		for (let i = 0; i < vertexCount; i++) {
			// ×4096 保留次像素精度（参考实现同此）
			const depth =
				((ax * f[8 * i] + ay * f[8 * i + 1] + az * f[8 * i + 2]) * 4096) | 0;
			quantized[i] = depth;
			if (depth > maxDepth) maxDepth = depth;
			if (depth < minDepth) minDepth = depth;
		}

		// 全部顶点在同一深度平面（或只有一个顶点）：排序无意义，保持原序
		if (!(maxDepth > minDepth)) {
			lastAxis = [ax, ay, az];
			return undefined;
		}

		const BUCKETS = 256 * 256;
		const depthInv = (BUCKETS - 1) / (maxDepth - minDepth);
		const counts = new Uint32Array(BUCKETS);
		for (let i = 0; i < vertexCount; i++) {
			quantized[i] = ((quantized[i] - minDepth) * depthInv) | 0;
			counts[quantized[i]]++;
		}
		const starts = new Uint32Array(BUCKETS);
		for (let i = 1; i < BUCKETS; i++) starts[i] = starts[i - 1] + counts[i - 1];
		const next = new Uint32Array(vertexCount);
		for (let i = 0; i < vertexCount; i++) next[starts[quantized[i]]++] = i;

		depthIndex = next;
		lastAxis = [ax, ay, az];
		return next;
	}

	return {
		load,
		sort,
		get vertexCount() {
			return vertexCount;
		},
	};
}
