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
	/**
	 * 按深度轴重排，**总是返回一个可用的索引**（视角没怎么变时复用上一次的结果，
	 * 不重算）。必须"有请求就有回答"：调用方靠这次回答清掉"排序在飞"的标记，
	 * 一旦漏答，之后所有相机移动都不会再触发排序（表现为转到背面还是正面的画面）。
	 */
	sort(axis: readonly [number, number, number]): Uint32Array;
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
	function sort(axis: readonly [number, number, number]): Uint32Array {
		if (!splatBytes || vertexCount === 0) return depthIndex;
		const [ax, ay, az] = axis;
		if (lastAxis) {
			// 前向轴几乎没变就不重算（阈值同参考实现），但仍把当前顺序回给调用方
			const dot = lastAxis[0] * ax + lastAxis[1] * ay + lastAxis[2] * az;
			if (Math.abs(dot - 1) < 0.001) return depthIndex;
		}

		// 紧凑数组每顶点 8 个 f32：位置 3 + 缩放 3 + 颜色/旋转各 1
		const f = new Float32Array(
			splatBytes.buffer,
			splatBytes.byteOffset,
			vertexCount * 8,
		);
		// 深度先按 float 算，再按**实际范围**量化到 65536 个桶。
		// 参考实现是 `depth * 4096 | 0`（存进 int32）：坐标量级一大（地理配准的点云、
		// 超大场景）就会在符号位翻折处溢出成乱序，画面表现是"严重错乱/变形"。
		const depths = new Float32Array(vertexCount);
		let maxDepth = Number.NEGATIVE_INFINITY;
		let minDepth = Number.POSITIVE_INFINITY;
		for (let i = 0; i < vertexCount; i++) {
			const depth = ax * f[8 * i] + ay * f[8 * i + 1] + az * f[8 * i + 2];
			depths[i] = depth;
			if (depth > maxDepth) maxDepth = depth;
			if (depth < minDepth) minDepth = depth;
		}

		// 全部顶点在同一深度平面（或只有一个顶点）：排序无意义，保持原序
		if (!(maxDepth > minDepth)) {
			lastAxis = [ax, ay, az];
			return depthIndex;
		}

		const BUCKETS = 256 * 256;
		const depthInv = (BUCKETS - 1) / (maxDepth - minDepth);
		// 桶号不超过 BUCKETS-1，用 Uint16 存就够（省一半内存）
		const quantized = new Uint16Array(vertexCount);
		const counts = new Uint32Array(BUCKETS);
		for (let i = 0; i < vertexCount; i++) {
			const bucket = ((depths[i] - minDepth) * depthInv) | 0;
			quantized[i] = bucket;
			counts[bucket]++;
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
