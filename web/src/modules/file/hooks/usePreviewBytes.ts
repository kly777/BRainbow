// ── 二进制文件的内容获取（fetch 带凭据 → 前若干字节） ──

import { buildHeaders } from "@shared/api";
import { createResource, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../api.ts";

/**
 * 允许下载来预览的大小上限：十六进制预览只需要文件头，
 * 但后端的内容路由是流式整文件响应（不支持 Range），所以要自己设界限——
 * 超过这个大小就不下载，改给下载入口。
 * 将来后端支持 Range 后，这里可以只取前 4KB（加一个 Range 头即可），不必先整包下来。
 */
export const MAX_BYTES_FETCH = 2 * 1024 * 1024;

/** 十六进制查看器展示的字节数（256 行） */
export const MAX_BYTES_VIEW = 4 * 1024;

export interface PreviewBytes {
	data?: Uint8Array;
	/** 文件比展示上限长（只显示了前 4KB） */
	truncated: boolean;
	/** 文件超过下载上限，没有取内容 */
	tooLarge: boolean;
}

/** 拉取二进制内容；失败走单独信号，不抛穿（同 usePreviewText 的理由） */
export function usePreviewBytes(item: () => FileItem) {
	let controller: AbortController | undefined;
	onCleanup(() => controller?.abort());

	const [error, setError] = createSignal<string | undefined>(undefined);
	const [content] = createResource<PreviewBytes | undefined, string>(
		() => item().stored_id,
		async () => {
			const current = item();
			if (current.size_bytes > MAX_BYTES_FETCH) {
				setError(undefined);
				return { truncated: false, tooLarge: true };
			}
			controller = new AbortController();
			const resp = await fetch(current.url, {
				signal: controller.signal,
				headers: buildHeaders(),
			});
			if (!resp.ok) {
				setError(`加载失败（HTTP ${resp.status}）`);
				return undefined;
			}
			const all = new Uint8Array(await resp.arrayBuffer());
			setError(undefined);
			return {
				data: all.subarray(0, MAX_BYTES_VIEW),
				truncated: all.length > MAX_BYTES_VIEW,
				tooLarge: false,
			};
		},
	);

	return { content, error };
}
