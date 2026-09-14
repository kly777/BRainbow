// ── 3DGS 排序 worker ──
//
// 为什么要 worker：每帧要按深度重排几十万个顶点（计数排序），放主线程会卡住交互。
// 为什么用 `new Worker(new URL(...), { type: "module" })` 而不是 Blob URL：
// 线上 CSP 的 script-src 是 'self'，没有 worker-src，blob: 的 worker 会被拦掉；
// 模块 worker 由打包器输出成同源 chunk，正好落在 'self' 里。
//
// 排序与纹理打包的算法取自 antimatter15/splat（MIT License, Copyright (c) 2023 Kevin Kwok）
// https://github.com/antimatter15/splat —— 数学与阈值未改动，数据结构换成显式类型。

import {
	buildSplatData,
	buildSplatTexture,
	type SplatBounds,
} from "../../lib/ply.ts";

export interface SplatLoadRequest {
	type: "load";
	/** PLY 文件字节（transferable，零拷贝） */
	ply: ArrayBuffer;
}

export interface SplatSortRequest {
	type: "sort";
	/** 相机的前向轴（世界坐标）；按 pos·axis 升序排——先画近的，配合反向 alpha 混合 */
	depthAxis: [number, number, number];
}

export type SplatRequest = SplatLoadRequest | SplatSortRequest;

export interface SplatLoadedResponse {
	type: "loaded";
	vertexCount: number;
	bounds: SplatBounds;
	/** 普通点云（无高斯参数）——UI 里提示一下 */
	pointCloud: boolean;
	/** 顶点纹理数据（RGBA32UI，每顶点两个 texel） */
	texdata: ArrayBuffer;
	texWidth: number;
	texHeight: number;
}

export interface SplatSortedResponse {
	type: "sorted";
	depthIndex: ArrayBuffer;
}

export interface SplatFailedResponse {
	type: "failed";
	message: string;
}

export type SplatResponse =
	| SplatLoadedResponse
	| SplatSortedResponse
	| SplatFailedResponse;

/** 纹理宽度：1024×2，与参考实现一致（索引纹理的寻址常量 0x3ff 依赖它） */
const TEX_WIDTH = 1024 * 2;

const scope = self as unknown as {
	onmessage: ((e: MessageEvent<SplatRequest>) => void) | null;
	postMessage: (message: SplatResponse, transfer?: Transferable[]) => void;
};

let splatBytes: Uint8Array | undefined;
let vertexCount = 0;
let depthIndex = new Uint32Array();
/** 上次排序用的轴，用来跳过"视角没怎么变"的重复排序 */
let lastAxis: [number, number, number] | undefined;

function load(ply: ArrayBuffer): SplatLoadedResponse {
	const data = buildSplatData(new Uint8Array(ply));
	const { texdata, texHeight } = buildSplatTexture(data, TEX_WIDTH);
	splatBytes = data.bytes;
	vertexCount = data.vertexCount;
	lastAxis = undefined;
	// 初始顺序即"按 importance"，先能看，等第一帧的深度排序到达再换
	depthIndex = new Uint32Array(vertexCount);
	for (let i = 0; i < vertexCount; i++) depthIndex[i] = i;
	return {
		type: "loaded",
		vertexCount,
		bounds: data.bounds,
		pointCloud: data.pointCloud,
		texdata: texdata.buffer as ArrayBuffer,
		texWidth: TEX_WIDTH,
		texHeight,
	};
}

/**
 * 16 位单遍计数排序（按深度分桶）。顶点数上到几十万时这比比较排序快一个量级，
 * 也是参考实现唯一用的排序方式。
 */
function sort(axis: [number, number, number]): Uint32Array {
	if (!splatBytes || vertexCount === 0) return depthIndex;
	const f = new Float32Array(
		splatBytes.buffer,
		splatBytes.byteOffset,
		vertexCount * 8,
	);
	const [ax, ay, az] = axis;

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

	// 所有顶点在同一深度平面（或只有一个顶点）：排序无意义，保持原序
	if (!(maxDepth > minDepth)) return depthIndex;

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
	return next;
}

scope.onmessage = (e: MessageEvent<SplatRequest>) => {
	const msg = e.data;
	try {
		if (msg.type === "load") {
			const loaded = load(msg.ply);
			scope.postMessage(loaded, [loaded.texdata]);
			return;
		}
		if (msg.type === "sort") {
			if (!splatBytes) return;
			const axis = msg.depthAxis;
			// 视角几乎没动就不重排（阈值同参考实现：前向轴夹角很小）
			if (lastAxis) {
				const dot =
					lastAxis[0] * axis[0] + lastAxis[1] * axis[1] + lastAxis[2] * axis[2];
				if (Math.abs(dot - 1) < 0.001) return;
			}
			const sorted = sort(axis);
			lastAxis = axis;
			// 拷一份再转移：depthIndex 本身要继续复用
			const copy = sorted.slice();
			scope.postMessage(
				{ type: "sorted", depthIndex: copy.buffer as ArrayBuffer },
				[copy.buffer as ArrayBuffer],
			);
		}
	} catch (err) {
		scope.postMessage({
			type: "failed",
			message: err instanceof Error ? err.message : String(err),
		});
	}
};
