// ── 文本类文件的内容获取（fetch 带凭据 + Range 取头部） ──

import { buildHeaders } from "@shared/api";
import { createResource, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../api.ts";
import {
	httpPreviewError,
	networkPreviewError,
	type PreviewErrorInfo,
} from "../lib/previewError.ts";

/**
 * 预览截断阈值（字节）：再大就只取前 4MB，并提示可下载看全文。
 *
 * 早先这里是"整包下载 → 按字符截断"：`text/plain` 的后端上限是 500MB，一个 200MB 的
 * `.log` 会真的被拉下来、再解成两亿字符的 JS 字符串（UTF-16 下约 400MB 内存），
 * 而截断发生在这一切之后。后端的内容路由本来就支持单段 `Range`
 * （见 doc/file-service.md §8.6），取头部即可 —— 与 usePreviewPly 同一条路。
 */
export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

export interface PreviewText {
	text: string;
	truncated: boolean;
}

/**
 * 解码一段字节。
 *
 * `stream: true` 让解码器把**结尾处不完整的多字节字符**留在内部缓冲里，而不是吐成
 * U+FFFD —— 我们按字节边界切段，中文很可能正好被切在半个字符上。
 * 被截断时那个残尾直接丢弃（它本来也不该出现在预览里）。
 */
function decodeChunk(bytes: Uint8Array, truncated: boolean): string {
	const text = new TextDecoder("utf-8").decode(bytes, { stream: truncated });
	return truncated && text.endsWith("\uFFFD") ? text.slice(0, -1) : text;
}

/**
 * 拉取文本内容。**加载失败不抛错**，而是走单独的信号：
 * 抛错会中断 Solid 的响应式更新，loading 会一直停在 true，
 * 于是"加载中…"与错误提示会同时挂着。
 */
export function usePreviewText(item: () => FileItem) {
	let controller: AbortController | undefined;
	onCleanup(() => controller?.abort());

	const [error, setError] = createSignal<PreviewErrorInfo | undefined>(
		undefined,
	);
	const [content, { refetch }] = createResource<
		PreviewText | undefined,
		string
	>(
		() => item().stored_id,
		async () => {
			controller = new AbortController();
			const current = item();
			let resp: Response;
			try {
				// URL 取自接口响应（不再本地拼接）；私密文件的内容接口需要凭据
				resp = await fetch(current.url, {
					signal: controller.signal,
					headers: {
						...buildHeaders(),
						Range: `bytes=0-${MAX_PREVIEW_BYTES - 1}`,
					},
				});
			} catch {
				// 断网/DNS 失败：这条可重试，别让它退化成一句干巴巴的"加载失败"
				setError(networkPreviewError());
				return undefined;
			}
			if (!resp.ok) {
				setError(httpPreviewError(resp.status));
				return undefined;
			}
			const bytes = new Uint8Array(await resp.arrayBuffer());
			// 206 = 服务端按 Range 给了这一段（满一段说明后面还有内容）；
			// 200 = 服务端忽略了 Range（老后端 / 中间缓存），拿到的是整文件，按长度判断
			const truncated =
				resp.status === 206
					? bytes.length >= MAX_PREVIEW_BYTES
					: bytes.length > MAX_PREVIEW_BYTES;
			setError(undefined);
			return { text: decodeChunk(bytes, truncated), truncated };
		},
	);

	return {
		content,
		error,
		/** 重试（网络抖动 / 5xx 时给用户用） */
		retry: () => void refetch(),
	};
}
