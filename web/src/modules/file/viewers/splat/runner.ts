// ── 泼溅运行器：优先用 worker，起不来或没响应就退回主线程 ──
//
// 为什么要有这一层：worker 链路有几种**静默失败**的可能——浏览器不支持模块 worker、
// CSP/MIME 把脚本拦下、脚本加载成功但不回消息。任一种都会让预览永远停在"正在解析"，
// 用户看不到任何原因。这里把"没有响应"也当成一种可恢复的失败：切主线程把同样的
// 解析与排序再做一遍，代价是大文件拖动会卡，但至少能看。
//
// 主线程分支直接用同一份 engine（解析/排序逻辑只有一套），worker 只是它的并发外壳。

import { createSplatEngine, type LoadedSplat, TEX_WIDTH } from "./engine.ts";
import type { SplatRequest, SplatResponse } from "./worker.ts";

/** 解析结果里渲染需要的部分（worker 与主线程两条路径统一成这个形状） */
export interface SplatLoadResult {
	vertexCount: number;
	bounds: LoadedSplat["bounds"];
	/** 顶点位置抽样：自动取景按点的分布定距离 */
	sample: Float32Array;
	pointCloud: boolean;
	texdata: Uint32Array;
	texWidth: number;
	texHeight: number;
	/** 初始顺序（按 importance）：首帧可画，不必等第一次深度排序 */
	depthIndex: Uint32Array;
}

export interface SplatRunHandlers {
	onLoaded(result: SplatLoadResult): void;
	/**
	 * 排序的答复。**每个排序请求都必须走到这里一次** —— 调用方靠它清掉"排序在飞"
	 * 的标记，漏答会让之后所有相机移动都不再触发排序（踩过坑，见 engine.ts）。
	 * `depthIndex` 为 `undefined` 表示顺序**没变**（视角几乎没动）：只要清标记，
	 * 不要重新上传索引 —— 那份索引在几十万顶点的场景里是几 MB，来回搬正是拖拽时
	 * 最大的开销（参考实现在这种情况下干脆什么都不回）。
	 */
	onSorted(depthIndex: Uint32Array | undefined): void;
	/** 真正的内容错误（PLY 不可解析），不再是环境问题 */
	onFailed(message: string): void;
	/** 从 worker 退回主线程时通知一声（UI 提示"可能会卡"） */
	onDegraded?(reason: string): void;
}

export interface SplatRunner {
	readonly mode: "worker" | "inline";
	load(bytes: Uint8Array): void;
	sort(axis: readonly [number, number, number]): void;
	dispose(): void;
}

export type SplatAxis = readonly [number, number, number];

/** worker 多久不回消息就认为这条链路不可用（解析大文件可能略久，给足余量） */
export const WORKER_TIMEOUT_MS = 8000;

function tryCreateWorker(): Worker | undefined {
	if (typeof Worker === "undefined") return undefined;
	try {
		return new Worker(new URL("./worker.ts", import.meta.url), {
			type: "module",
		});
	} catch {
		// 老浏览器不支持模块 worker 时构造就会抛
		return undefined;
	}
}

export function createSplatRunner(
	handlers: SplatRunHandlers,
	timeoutMs = WORKER_TIMEOUT_MS,
): SplatRunner {
	let mode: "worker" | "inline" = "worker";
	let worker: Worker | undefined = tryCreateWorker();
	const inline = createSplatEngine();
	let lastBytes: Uint8Array | undefined;
	let lastAxis: SplatAxis | undefined;
	let watchdog: ReturnType<typeof setTimeout> | undefined;

	const clearWatchdog = () => {
		if (watchdog !== undefined) {
			clearTimeout(watchdog);
			watchdog = undefined;
		}
	};

	const runInline = (bytes: Uint8Array, axis?: SplatAxis) => {
		try {
			const loaded = inline.load(bytes);
			handlers.onLoaded({
				vertexCount: loaded.vertexCount,
				bounds: loaded.bounds,
				sample: loaded.sample,
				pointCloud: loaded.pointCloud,
				texdata: loaded.texdata,
				texWidth: loaded.texWidth,
				texHeight: loaded.texHeight,
				depthIndex: loaded.depthIndex,
			});
			// 有请求就必须答复（哪怕是 undefined = 顺序没变）
			if (axis) handlers.onSorted(inline.sort(axis));
		} catch (err) {
			handlers.onFailed(err instanceof Error ? err.message : String(err));
		}
	};

	/** 退回主线程：把当前这份数据与视角在本地重做一遍 */
	const degrade = (reason: string) => {
		if (mode === "inline") return;
		clearWatchdog();
		worker?.terminate();
		worker = undefined;
		mode = "inline";
		handlers.onDegraded?.(reason);
		if (lastBytes) runInline(lastBytes, lastAxis);
	};

	const onWorkerMessage = (event: MessageEvent<SplatResponse>) => {
		const msg = event.data;
		try {
			if (msg.type === "loaded") {
				clearWatchdog();
				handlers.onLoaded({
					vertexCount: msg.vertexCount,
					bounds: msg.bounds,
					sample: new Float32Array(msg.sample),
					pointCloud: msg.pointCloud,
					texdata: new Uint32Array(msg.texdata),
					texWidth: msg.texWidth,
					texHeight: msg.texHeight,
					depthIndex: new Uint32Array(msg.depthIndex),
				});
				return;
			}
			if (msg.type === "sorted") {
				handlers.onSorted(new Uint32Array(msg.depthIndex));
				return;
			}
			if (msg.type === "sort-skipped") {
				// 顺序没变：清掉"排序在飞"的标记，但不重新上传索引、也不重绘
				handlers.onSorted(undefined);
				return;
			}
			handlers.onFailed(msg.message);
		} catch (err) {
			// 处理消息时自己出错也要说出来，不能停在加载态
			handlers.onFailed(err instanceof Error ? err.message : String(err));
		}
	};

	if (worker) {
		worker.onmessage = onWorkerMessage;
		worker.onerror = (e) =>
			degrade(`渲染线程出错（${e.message || "未知原因"}），已切到主线程`);
	} else {
		mode = "inline";
	}

	return {
		get mode() {
			return mode;
		},

		load(bytes) {
			lastBytes = bytes;
			if (mode === "inline") {
				runInline(bytes, lastAxis);
				return;
			}
			clearWatchdog();
			watchdog = setTimeout(
				() => degrade("渲染线程没有响应，已切到主线程"),
				timeoutMs,
			);
			// 转移前复制一份：退回主线程时还要用同一份字节
			const copy = bytes.slice();
			worker?.postMessage(
				{
					type: "load",
					ply: copy.buffer as ArrayBuffer,
				} satisfies SplatRequest,
				[copy.buffer as ArrayBuffer],
			);
		},

		sort(axis) {
			lastAxis = axis;
			if (mode === "inline") {
				// 同上：答复必须有，哪怕是"顺序没变"
				handlers.onSorted(inline.sort(axis));
				return;
			}
			worker?.postMessage({
				type: "sort",
				depthAxis: [axis[0], axis[1], axis[2]],
			} satisfies SplatRequest);
		},

		dispose() {
			clearWatchdog();
			worker?.terminate();
			worker = undefined;
		},
	};
}

export { TEX_WIDTH };
