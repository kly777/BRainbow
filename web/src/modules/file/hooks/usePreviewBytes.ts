// ── 二进制文件的内容获取（fetch 带凭据 + Range 按段取） ──
//
// 十六进制预览只需要文件头，而后端的内容路由支持单段 Range（见 doc/file-service.md §8.6），
// 所以这里按段取、翻页时再取下一段。早先的做法是"整包下载 + 2MB 闸门"：超过 2MB 的白名单外
// 二进制（.psd / .las / 未知格式）连文件头都看不到，只能看下载面板 —— 而 200MB 的 .ply
// 反倒能全量 3D 预览，观感上自相矛盾。那条注释当时写的是"后端不支持 Range"，早就过期了。

import { buildHeaders } from "@shared/api";
import { createResource, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../api.ts";
import { totalFromContentRange } from "./usePreviewPly.ts";

/** 十六进制查看器每段展示的字节数（256 行） */
export const HEX_SEGMENT_BYTES = 4 * 1024;

export interface PreviewBytes {
	/** 本段的字节（文件不支持 Range 时是整文件切出来的那一段） */
	data: Uint8Array;
	/** 本段在文件中的起始偏移 */
	offset: number;
	/** 后面还有内容 */
	hasMore: boolean;
	/** 文件总大小（磁盘实况优先） */
	totalBytes: number;
}

/**
 * 拉取二进制内容的一段；`offset` 变化就重新取（翻页）。失败走单独信号，不抛穿
 * （同 usePreviewText 的理由）。
 */
export function usePreviewBytes(item: () => FileItem, offset: () => number) {
	let controller: AbortController | undefined;
	onCleanup(() => controller?.abort());

	const [error, setError] = createSignal<string | undefined>(undefined);
	const [content] = createResource<PreviewBytes | undefined, string>(
		() => `${item().stored_id}:${offset()}`,
		async () => {
			const current = item();
			const start = Math.max(0, offset());
			controller = new AbortController();
			const resp = await fetch(current.url, {
				signal: controller.signal,
				headers: {
					...buildHeaders(),
					Range: `bytes=${start}-${start + HEX_SEGMENT_BYTES - 1}`,
				},
			});
			if (!resp.ok) {
				setError(`加载失败（HTTP ${resp.status}）`);
				return undefined;
			}
			const body = new Uint8Array(await resp.arrayBuffer());
			// 200 = 服务端忽略了 Range（老后端 / 中间缓存），拿到的是整文件，自己切段
			const data =
				resp.status === 206
					? body
					: body.subarray(start, start + HEX_SEGMENT_BYTES);
			// 总长优先信 Content-Range 的 /total（长度取磁盘实况，与内容路由同一原则）
			const totalBytes =
				totalFromContentRange(resp.headers.get("content-range")) ??
				current.size_bytes;
			setError(undefined);
			return {
				data,
				offset: start,
				hasMore: start + data.length < totalBytes,
				totalBytes,
			};
		},
	);

	return { content, error };
}
