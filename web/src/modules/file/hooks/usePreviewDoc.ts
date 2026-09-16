// ── Office 文档预览：向后端预览端点要"解析好的结构"，而不是原始字节 ──
//
// 为什么解析在服务端：docx / xlsx 都是 zip + XML，前端没有既轻量又可信的解析器
// （npm 上的 `xlsx` 已停更且有已知漏洞），Rust 侧的 `zip`+`quick-xml` 与 `calamine`
// 成熟得多；顺带把"多大才肯解析"的闸门放在服务端。这里只负责取回 JSON 与报错。

import { buildHeaders } from "@shared/api";
import { createResource, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../api.ts";

/** 一张表（服务端已把单元格转成显示用文本） */
export interface SheetData {
	name: string;
	rows: string[][];
	/** 该表实际的行/列数（`rows` 是截断后的，前端据此提示） */
	total_rows: number;
	total_cols: number;
}

/** 服务端解析结果（判别字段 `kind` 与查看器一一对应） */
export type DocPreview =
	| { kind: "docx"; html: string; truncated: boolean }
	| { kind: "sheet"; sheets: SheetData[]; truncated: boolean };

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

	const [error, setError] = createSignal<string | undefined>(undefined);
	const [preview] = createResource<DocPreview | undefined, string>(
		() => item().stored_id,
		async () => {
			const url = previewUrlOf(item());
			if (!url) {
				setError("预览地址不可用");
				return undefined;
			}
			controller = new AbortController();
			const resp = await fetch(url, {
				signal: controller.signal,
				headers: buildHeaders(),
			});
			if (!resp.ok) {
				// 后端把"解析不了 / 太大"的原因放在 {code, message} 里，直接给用户看
				const body = (await resp.json().catch(() => undefined)) as
					| { message?: string }
					| undefined;
				setError(body?.message ?? `加载失败（HTTP ${resp.status}）`);
				return undefined;
			}
			setError(undefined);
			return (await resp.json()) as DocPreview;
		},
	);

	return { preview, error };
}
