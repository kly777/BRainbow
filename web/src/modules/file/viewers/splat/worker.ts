// ── 3DGS 排序 worker：泼溅引擎的通信适配层 ──
//
// 逻辑都在 engine.ts（可单测），这里只负责收发消息与错误兜底。
//
// 为什么用 worker：每帧要按深度重排几十万个顶点，放主线程会卡住交互。
// 为什么用 `new Worker(new URL(...), { type: "module" })` 而不是 Blob URL：
// 线上 CSP 的 script-src 是 'self' 且没有 worker-src，blob: 的 worker 会被拦掉；
// 模块 worker 由打包器输出成同源 chunk，正好落在 'self' 里。

import type { SplatBounds } from "../../lib/ply.ts";
import { createSplatEngine, TEX_WIDTH } from "./engine.ts";

export interface SplatLoadRequest {
	type: "load";
	/** PLY 文件字节（transferable，零拷贝） */
	ply: ArrayBuffer;
}

export interface SplatSortRequest {
	type: "sort";
	/** 相机前向轴（世界坐标）：按 pos·axis 升序排 —— 先画近的，配合反向 alpha 混合 */
	depthAxis: [number, number, number];
}

export type SplatRequest = SplatLoadRequest | SplatSortRequest;

export interface SplatLoadedResponse {
	type: "loaded";
	vertexCount: number;
	bounds: SplatBounds;
	pointCloud: boolean;
	/** 顶点位置抽样（扁平 xyz）：自动取景用，在主线程按视口宽度比例算距离 */
	sample: ArrayBuffer;
	texdata: ArrayBuffer;
	texWidth: number;
	texHeight: number;
	/** 初始顺序（按 importance）：让首帧就能画，不必等第一次深度排序回来 */
	depthIndex: ArrayBuffer;
}

export interface SplatSortedResponse {
	type: "sorted";
	depthIndex: ArrayBuffer;
}

/**
 * 排序请求的答复但**顺序没变**：不回索引。
 *
 * 为什么单独一条消息而不是回一条空的 sorted：索引在几十万顶点的场景里有几 MB，
 * 每次回包都 `slice()` 拷一份、转移、主线程再 `bufferData` 传上 GPU —— 而拖拽时
 * 大多数请求都是"视角只动了一点点"这种情况。**但答复本身不能省**：主线程的
 * "排序在飞"标记只在收到答复时清（漏答会让排序永久冻住，见 engine.ts 的 sort 注释）。
 */
export interface SplatSortSkippedResponse {
	type: "sort-skipped";
}

export interface SplatFailedResponse {
	type: "failed";
	message: string;
}

export type SplatResponse =
	| SplatLoadedResponse
	| SplatSortedResponse
	| SplatSortSkippedResponse
	| SplatFailedResponse;

const scope = self as unknown as {
	onmessage: ((e: MessageEvent<SplatRequest>) => void) | null;
	postMessage: (message: SplatResponse, transfer?: Transferable[]) => void;
};

const engine = createSplatEngine();

scope.onmessage = (e: MessageEvent<SplatRequest>) => {
	const msg = e.data;
	try {
		if (msg.type === "load") {
			const loaded = engine.load(new Uint8Array(msg.ply));
			const texdata = loaded.texdata.buffer as ArrayBuffer;
			// 取样转移走：worker 只在主线程取景时用得到它
			const sample = loaded.sample.buffer as ArrayBuffer;
			// 拷一份再转移：引擎内部还要继续用 depthIndex（转移会让原 buffer 失效）
			const initial = loaded.depthIndex.slice();
			const depthIndex = initial.buffer as ArrayBuffer;
			scope.postMessage(
				{
					type: "loaded",
					vertexCount: loaded.vertexCount,
					bounds: loaded.bounds,
					pointCloud: loaded.pointCloud,
					sample,
					texdata,
					texWidth: TEX_WIDTH,
					texHeight: loaded.texHeight,
					depthIndex,
				},
				[texdata, sample, depthIndex],
			);
			return;
		}
		if (msg.type === "sort") {
			// 答复必须有（主线程靠它清"排序在飞"的标记），但顺序没变时不回索引
			const sorted = engine.sort(msg.depthAxis);
			if (!sorted) {
				scope.postMessage({ type: "sort-skipped" });
				return;
			}
			// 拷一份再转移：depthIndex 本身要继续复用
			const copy = sorted.slice();
			const buffer = copy.buffer as ArrayBuffer;
			scope.postMessage({ type: "sorted", depthIndex: buffer }, [buffer]);
		}
	} catch (err) {
		scope.postMessage({
			type: "failed",
			message: err instanceof Error ? err.message : String(err),
		});
	}
};
