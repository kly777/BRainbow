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

export interface SplatFailedResponse {
	type: "failed";
	message: string;
}

export type SplatResponse =
	| SplatLoadedResponse
	| SplatSortedResponse
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
			// 拷一份再转移：引擎内部还要继续用 depthIndex（转移会让原 buffer 失效）
			const initial = loaded.depthIndex.slice();
			const depthIndex = initial.buffer as ArrayBuffer;
			scope.postMessage(
				{
					type: "loaded",
					vertexCount: loaded.vertexCount,
					bounds: loaded.bounds,
					pointCloud: loaded.pointCloud,
					texdata,
					texWidth: TEX_WIDTH,
					texHeight: loaded.texHeight,
					depthIndex,
				},
				[texdata, depthIndex],
			);
			return;
		}
		if (msg.type === "sort") {
			// 引擎保证"有请求就有回答"：漏答会让主线程的"排序在飞"标记永远清不掉
			const sorted = engine.sort(msg.depthAxis);
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
