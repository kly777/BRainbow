// ── 文本类文件的内容获取（fetch 带凭据 + Range 分段） ──
//
// 内容按段取，而不是"整包下载再截断"：`text/plain` 的后端上限是 500MB，早先的做法
// 会把整个文件拉下来、再解成上亿字符的 JS 字符串，而截断发生在这一切之后。后端的内容
// 路由支持单段 Range（见 doc/file-service.md §8.6），于是：
//
//   首屏  取头部一段（4MB）→ 不够就「载入更多」往下续，或者「看结尾」直接跳尾部
//
// 大日志最常见的需求恰恰是看**结尾**（最新的日志在末尾），而后端支持后缀请求
// （`bytes=-N`），所以「看结尾」是一次请求就能到达的 —— 不需要先下完 200MB。
//
// 这里刻意不用 createResource：追加与跳尾都是"在已有内容上继续"，用信号自己管更直白
// （资源原语适合"一个 key 一次取数"的形态）。

import { buildHeaders } from "@shared/api";
import { createEffect, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../api.ts";
import {
	httpPreviewError,
	networkPreviewError,
	type PreviewErrorInfo,
} from "../lib/previewError.ts";
import { totalFromContentRange } from "./usePreviewPly.ts";

/** 一次取多少字节（首屏、载入更多、看结尾都用它） */
export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

export interface PreviewText {
	text: string;
	/** 后面还有没取的内容 */
	truncated: boolean;
	/** 当前显示的是文件尾部（"看结尾"之后） */
	atTail: boolean;
	/** 已取到的字节数（进度与文案用） */
	loadedBytes: number;
	/** 文件总字节数（服务端 Content-Range 为准，未知时退化成已取字节数） */
	totalBytes: number;
}

/**
 * 文本内容获取。**加载失败不抛错**，而是走单独的信号：
 * 抛错会中断 Solid 的响应式更新，loading 会一直停在 true，
 * 于是"加载中…"与错误提示会同时挂着。
 *
 * `segmentBytes` 可注入是为了让测试能用几字节的"段"造出跨界字符、边界偏移这些场景
 * （同 `usePreviewPly` 的 `maxBytes` 参数）。
 */
export function usePreviewText(
	item: () => FileItem,
	segmentBytes = MAX_PREVIEW_BYTES,
) {
	const [content, setContent] = createSignal<PreviewText>();
	const [error, setError] = createSignal<PreviewErrorInfo | undefined>(
		undefined,
	);
	const [loading, setLoading] = createSignal(true);
	const [busy, setBusy] = createSignal(false);

	let controller: AbortController | undefined;
	// 请求序号：切文件/重试/翻页都会作废上一个请求的回包，避免旧响应覆盖新内容
	let requestId = 0;
	// **跨段共用一个解码器**：多字节字符被切在两段之间时，`stream: true` 会把它缓冲在
	// 解码器内部、由下一段补齐。每段各建一个解码器会把边界上的那个字符丢成"�"。
	let decoder = new TextDecoder("utf-8");
	onCleanup(() => controller?.abort());

	type Mode = "reset" | "append" | "tail";

	/** 取一段。range 是 Range 头的值（`bytes=0-4194303` / `bytes=-4194304`） */
	async function load(range: string, mode: Mode): Promise<void> {
		const id = ++requestId;
		controller = new AbortController();
		try {
			const resp = await fetch(item().url, {
				signal: controller.signal,
				headers: { ...buildHeaders(), Range: range },
			});
			if (id !== requestId) return; // 已被更新的请求取代
			if (!resp.ok) {
				setError(httpPreviewError(resp.status));
				return;
			}
			const bytes = new Uint8Array(await resp.arrayBuffer());
			const total =
				totalFromContentRange(resp.headers.get("content-range")) ??
				bytes.length;
			// 服务端忽略了 Range（老后端/中间缓存）时回的是整文件：此时"追加"没有意义
			// （会把整份内容再拼一遍），退化成重新装载
			const effective: Mode =
				mode === "append" && resp.status !== 206 ? "reset" : mode;

			if (effective !== "append") decoder = new TextDecoder("utf-8");
			let text = decoder.decode(bytes, { stream: true });
			// 跳尾时开头正落在半个字符上，会吐一个替换字符 —— 丢掉它
			if (effective === "tail" && text.startsWith("\uFFFD"))
				text = text.slice(1);

			const start =
				effective === "append"
					? (content()?.loadedBytes ?? 0)
					: effective === "tail"
						? Math.max(0, total - bytes.length)
						: 0;
			const loadedBytes = start + bytes.length;

			setError(undefined);
			setContent((prev) => ({
				text: (effective === "append" ? (prev?.text ?? "") : "") + text,
				atTail: effective === "tail",
				loadedBytes,
				totalBytes: Math.max(total, loadedBytes),
				truncated: loadedBytes < total,
			}));
		} catch {
			if (id === requestId) setError(networkPreviewError());
		}
	}

	/** 回到开头（首次装载、"回到开头"按钮、重试共用） */
	async function reload(): Promise<void> {
		setError(undefined);
		setLoading(true);
		setContent(undefined);
		await load(`bytes=0-${segmentBytes - 1}`, "reset");
		setLoading(false);
	}

	// 换文件就重新装载（键是 stored_id：同一个文件的重试走 reload）
	createEffect(() => {
		item().stored_id;
		void reload();
	});

	const loadMore = async () => {
		const current = content();
		if (!current || busy()) return;
		setBusy(true);
		await load(
			`bytes=${current.loadedBytes}-${current.loadedBytes + segmentBytes - 1}`,
			"append",
		);
		setBusy(false);
	};

	const loadTail = async () => {
		if (busy()) return;
		setBusy(true);
		await load(`bytes=-${segmentBytes}`, "tail");
		setBusy(false);
	};

	return {
		content,
		error,
		loading,
		busy,
		retry: () => void reload(),
		reload: () => void reload(),
		loadMore: () => void loadMore(),
		loadTail: () => void loadTail(),
	};
}
