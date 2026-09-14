// ── 文本类文件的内容获取（fetch 带凭据 → 文本 + 截断标记） ──

import { buildHeaders } from "@shared/api";
import { createResource, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../api.ts";

/** 预览截断阈值（字符数）：再大就只给前 2MB，并提示可下载看全文 */
export const MAX_PREVIEW_CHARS = 2 * 1024 * 1024;

export interface PreviewText {
	text: string;
	truncated: boolean;
}

/**
 * 拉取文本内容。**加载失败不抛错**，而是走单独的信号：
 * 抛错会中断 Solid 的响应式更新，loading 会一直停在 true，
 * 于是"加载中…"与错误提示会同时挂着。
 */
export function usePreviewText(item: () => FileItem) {
	let controller: AbortController | undefined;
	onCleanup(() => controller?.abort());

	const [error, setError] = createSignal<string | undefined>(undefined);
	const [content] = createResource<PreviewText | undefined, string>(
		() => item().stored_id,
		async () => {
			controller = new AbortController();
			// URL 取自接口响应（不再本地拼接）；私密文件的内容接口需要凭据
			const resp = await fetch(item().url, {
				signal: controller.signal,
				headers: buildHeaders(),
			});
			if (!resp.ok) {
				setError(`加载失败（HTTP ${resp.status}）`);
				return undefined;
			}
			const raw = await resp.text();
			setError(undefined);
			const truncated = raw.length > MAX_PREVIEW_CHARS;
			return {
				text: truncated ? raw.slice(0, MAX_PREVIEW_CHARS) : raw,
				truncated,
			};
		},
	);

	return { content, error };
}
