// ── Office 文档预览：向后端预览端点要"解析好的结构"，而不是原始字节 ──
//
// 为什么解析在服务端：docx / xlsx 都是 zip + XML，前端没有既轻量又可信的解析器
// （npm 上的 `xlsx` 已停更且有已知漏洞），Rust 侧的 `zip`+`quick-xml` 与 `calamine`
// 成熟得多；顺带把"多大才肯解析"的闸门放在服务端。这里只负责取回 JSON 与报错。

import { buildHeaders } from "@shared/api";
import { createResource, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../api.ts";
import {
	httpPreviewError,
	networkPreviewError,
	type PreviewErrorInfo,
} from "../lib/previewError.ts";
import {
	hasMore,
	mergePage,
	previewUrlWithCursor,
} from "../lib/previewPaging.ts";

/** 一张表（服务端已把单元格转成显示用文本） */
export interface SheetData {
	name: string;
	rows: string[][];
	/** 该表实际的行/列数（`rows` 是截断后的，前端据此提示） */
	total_rows: number;
	total_cols: number;
}

/** 一页幻灯片 */
export interface SlideData {
	title: string;
	lines: string[];
	notes: string;
}

/** 压缩包里的一个条目 */
export interface ArchiveEntry {
	name: string;
	size: number;
	compressed_size: number;
	dir: boolean;
}

/** 数据库里的一张表 */
export interface DatabaseTable {
	name: string;
	columns: string[];
	rows: string[][];
}

/** 电子书的一章 */
export interface BookChapter {
	title: string;
	html: string;
}

/** 服务端解析结果（判别字段 `kind` 与查看器一一对应） */
type DocPreviewBody =
	| { kind: "docx"; html: string; truncated: boolean }
	| { kind: "sheet"; sheets: SheetData[]; truncated: boolean }
	| { kind: "slides"; slides: SlideData[]; truncated: boolean }
	| {
			kind: "book";
			title: string;
			author: string;
			chapters: BookChapter[];
			truncated: boolean;
	  }
	| {
			kind: "database";
			tables: DatabaseTable[];
			truncated: boolean;
	  }
	| {
			kind: "archive";
			format: string;
			entries: ArchiveEntry[];
			truncated: boolean;
			total_bytes: number;
	  };

/**
 * `next_cursor` 只对**可分页的类型**（sheet / database）出现，服务端其余类型不带它。
 * 挂在联合外层而不是各分支上：客户端读它时不必先按 kind 收窄。
 */
export type DocPreview = DocPreviewBody & { next_cursor?: string };

/**
 * 预览端点由服务端给的内容 URL 派生：`…/{stored_id}/data/{文件名}` → `…/{stored_id}/preview`。
 *
 * 不自己拼前缀 —— URL 的形状是后端说了算（见 api.ts「前端不再自行拼接」），
 * 这里只换掉最后一段；形状对不上时返回 undefined，调用方给一句可读的失败提示。
 */
export function previewUrlOf(item: FileItem): string | undefined {
	const matched = /^(.*\/[^/]+)\/data\/[^/]+$/.exec(item.url);
	return matched?.[1] ? `${matched[1]}/preview` : undefined;
}

/** 拉取后端解析结果。**失败不抛错**，走单独的信号（同 usePreviewText 的理由） */
export function usePreviewDoc(item: () => FileItem) {
	let controller: AbortController | undefined;
	onCleanup(() => controller?.abort());

	const [error, setError] = createSignal<PreviewErrorInfo | undefined>(
		undefined,
	);
	const [paging, setPaging] = createSignal(false);
	const [preview, { refetch, mutate }] = createResource<
		DocPreview | undefined,
		string
	>(
		() => item().stored_id,
		async () => {
			const url = previewUrlOf(item());
			if (!url) {
				setError({
					message: "预览地址不可用",
					retryable: false,
					hint: "可下载后用本地工具打开",
				});
				return undefined;
			}
			controller = new AbortController();
			let resp: Response;
			try {
				resp = await fetch(url, {
					signal: controller.signal,
					headers: buildHeaders(),
				});
			} catch {
				setError(networkPreviewError());
				return undefined;
			}
			if (!resp.ok) {
				// 后端把"解析不了 / 太大"的原因放在 {code, message} 里，直接给用户看
				const body = (await resp.json().catch(() => undefined)) as
					| { message?: string }
					| undefined;
				setError(httpPreviewError(resp.status, body?.message));
				return undefined;
			}
			setError(undefined);
			return (await resp.json()) as DocPreview;
		},
	);

	/**
	 * 「载入更多」：把 `next_cursor` 原样回传给同一个端点，服务端会把被游标指定的
	 * 那个容器从偏移处继续给 —— 客户端把新行**追加**到那个容器上（见 lib/previewPaging.ts）。
	 *
	 * `index` 是当前活跃容器的下标（第几张表），只有查看器知道，所以由它传进来。
	 */
	const loadMore = async (index: number) => {
		const current = preview();
		const cursor = (current as DocPreview | undefined)?.next_cursor;
		if (!current || !cursor || paging()) return;
		const url = previewUrlOf(item());
		if (!url) return;
		setPaging(true);
		controller = new AbortController();
		try {
			const resp = await fetch(previewUrlWithCursor(url, cursor), {
				signal: controller.signal,
				headers: buildHeaders(),
			});
			if (!resp.ok) {
				const body = (await resp.json().catch(() => undefined)) as
					| { message?: string }
					| undefined;
				setError(httpPreviewError(resp.status, body?.message));
				return;
			}
			const next = (await resp.json()) as DocPreview;
			// 只追加到 index 那个容器，其余沿用已有内容（见 mergePage 的说明）
			mutate(() => mergePage(current, next, index));
		} catch {
			setError(networkPreviewError());
		} finally {
			setPaging(false);
		}
	};

	return {
		preview,
		error,
		retry: () => void refetch(),
		loadMore,
		paging,
		hasMore: () => hasMore(preview() as DocPreview | undefined),
	};
}
