// ── 3DGS .ply 的内容获取：先用 Range 取头部探大小，再决定要不要整包下载 ──
//
// 为什么值得多一次请求：3DGS 的 .ply 动辄几十上百 MB，直接整包拉下来才发现
// "这不是高斯文件"或"太大了"，对用户就是白等几十秒。后端支持 Range 之后，
// 用一个 64KB 的分段请求就能拿到总大小（Content-Range 的 /total），
// 文件小的时候这一次响应本身就是全量内容，不必再请求一次。

import { buildHeaders } from "@shared/api";
import { createResource, onCleanup } from "solid-js";
import type { FileItem } from "../api.ts";

/** 探测用分段大小：比 3DGS 的头部（几百字节～几 KB）宽裕得多 */
const PROBE_BYTES = 64 * 1024;

/**
 * 客户端上限：超过就只给下载入口，不在浏览器里解析。
 * 后端 `other` 类别放到 4GB 之后，这道线拦的不再是"后端收不收"（那边能存），
 * 而是浏览器内存与解析耗时 —— 整包 Uint8Array + 高斯点排序会直接把标签页拖死，
 * 几百 MB 以上就该交给本地 3DGS 工具。
 */
export const MAX_PLY_BYTES = 256 * 1024 * 1024;

/**
 * 探测 + 下载的整体超时。fetch 本身没有超时，网络卡住时预览会永远停在"加载中" ——
 * 这是最容易被当成"功能坏了"的状态，所以宁可超时报错。
 */
export const PLY_LOAD_TIMEOUT_MS = 30_000;

export type PlyLoad =
	| { kind: "ready"; bytes: Uint8Array; sizeBytes: number }
	| { kind: "too-large"; sizeBytes: number }
	| { kind: "failed"; message: string };

/** 从 `Content-Range: bytes 0-65535/12345` 里取总大小 */
export function totalFromContentRange(
	value: string | null,
): number | undefined {
	if (!value) return undefined;
	const total = Number.parseInt(value.slice(value.lastIndexOf("/") + 1), 10);
	return Number.isFinite(total) ? total : undefined;
}

/** 加载阶段：探测（只看头部几十 KB）→ 整包下载。下载几十 MB 时用户需要知道在等什么 */
export type PlyPhase =
	| { kind: "probing" }
	| { kind: "downloading"; sizeBytes: number };

async function fetchPly(
	item: FileItem,
	maxBytes: number,
	signal: AbortSignal,
	timeoutMs = PLY_LOAD_TIMEOUT_MS,
	onPhase?: (phase: PlyPhase) => void,
): Promise<PlyLoad> {
	// 两个取消来源合一：外部清理（切文件/卸载）与自身超时。
	// 不用 AbortSignal.any：它不在项目的浏览器基线里（chrome111 / firefox114）。
	const request = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		request.abort();
	}, timeoutMs);
	const onOuterAbort = () => request.abort();
	signal.addEventListener("abort", onOuterAbort);

	try {
		// 1) 探头部与总大小
		onPhase?.({ kind: "probing" });
		const probe = await fetch(item.url, {
			signal: request.signal,
			headers: { ...buildHeaders(), Range: `bytes=0-${PROBE_BYTES - 1}` },
		});
		if (!probe.ok)
			return { kind: "failed", message: `加载失败（HTTP ${probe.status}）` };
		const probeBytes = new Uint8Array(await probe.arrayBuffer());
		const headerLength = Number.parseInt(
			probe.headers.get("content-length") ?? "",
			10,
		);
		// 没有 Content-Range 说明服务端忽略了 Range（老版本后端/中间缓存），
		// 这时 content-length 或响应长度就是文件大小
		const total =
			totalFromContentRange(probe.headers.get("content-range")) ??
			(Number.isFinite(headerLength) ? headerLength : probeBytes.length);

		if (total > maxBytes) return { kind: "too-large", sizeBytes: total };
		// 这一次响应已经拿到全部内容（文件比分段小）
		if (probeBytes.length >= total)
			return {
				kind: "ready",
				bytes: probeBytes.subarray(0, total),
				sizeBytes: total,
			};

		// 2) 整包拉取（几十上百 MB 的场景，把总大小报给调用方显示进度文案）
		onPhase?.({ kind: "downloading", sizeBytes: total });
		const full = await fetch(item.url, {
			signal: request.signal,
			headers: buildHeaders(),
		});
		if (!full.ok)
			return { kind: "failed", message: `加载失败（HTTP ${full.status}）` };
		const bytes = new Uint8Array(await full.arrayBuffer());
		return { kind: "ready", bytes, sizeBytes: bytes.length };
	} catch (err) {
		if (timedOut)
			return {
				kind: "failed",
				message: `加载超时（${Math.round(timeoutMs / 1000)} 秒）`,
			};
		if (err instanceof DOMException && err.name === "AbortError")
			return { kind: "failed", message: "已取消" };
		return {
			kind: "failed",
			message: `加载失败：${err instanceof Error ? err.message : String(err)}`,
		};
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", onOuterAbort);
	}
}

/** 拉取 .ply 内容。失败与"太大"都走返回值，不抛穿（同其他预览的约定）。
 *
 *  `onPhase` 是可选的第三方参数（现有调用点不必改）：把"正在探测"与"正在下载 N MB"
 *  报给调用方，用来把静止的"正在解析…"换成有进展的文案。
 */
export function usePreviewPly(
	item: () => FileItem,
	maxBytes = MAX_PLY_BYTES,
	onPhase?: (phase: PlyPhase) => void,
) {
	const controller = new AbortController();
	onCleanup(() => controller.abort());

	const [state] = createResource(
		() => item().stored_id,
		() =>
			fetchPly(
				item(),
				maxBytes,
				controller.signal,
				PLY_LOAD_TIMEOUT_MS,
				onPhase,
			),
	);
	return state;
}

/** 仅测试用：直接驱动一次加载流程 */
export const __internal = { fetchPly, PROBE_BYTES };
