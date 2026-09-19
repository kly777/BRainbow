// ── 预览分页的客户端合并（纯函数） ──
//
// 接口约定（见 doc/ux/file-preview-plan.md 的 P3-1）：游标请求返回**同一套 schema**，
// 只是被游标指定的那个容器从偏移处开始给行。所以客户端把新一页的**行**追加到那个容器上，
// 其余容器保持不动（服务端每次都把它们原样带回来）。
//
// 只有两种容器支持分页（sheet / database），其余类型没有 next_cursor —— 这里对
// "kind 不一致"或"没有游标"都退化成原样返回，不抛错（客户端不该因为服务端少给一个
// 字段就崩）。

import type { DocPreview } from "../hooks/usePreviewDoc.ts";

/** 这一页响应还有更多吗（游标是不透明串，原样回传给服务端即可取下一页） */
export function hasMore(data: DocPreview | undefined): boolean {
	return Boolean(data?.next_cursor);
}

/**
 * 把新一页合并进已有结果：**只追加到 index 指定的那个容器**，并采用新响应的游标。
 *
 * `index` 是查看器当前的活跃容器（第几张表 / 第几张数据库表）——只有它被取过下一页，
 * 其余容器的内容是首屏那一份（服务端会把它们原样带回来，直接沿用 prev 更省事，
 * 也避免把"另一张表的第一页"重复追加进去）。
 */
export function mergePage(
	prev: DocPreview,
	next: DocPreview,
	index: number,
): DocPreview {
	if (prev.kind !== next.kind) return prev;

	if (prev.kind === "sheet" && next.kind === "sheet") {
		return {
			...prev,
			sheets: prev.sheets.map((sheet, i) =>
				i === index && next.sheets[i]
					? { ...sheet, rows: [...sheet.rows, ...next.sheets[i].rows] }
					: sheet,
			),
			next_cursor: next.next_cursor,
		};
	}

	if (prev.kind === "database" && next.kind === "database") {
		return {
			...prev,
			tables: prev.tables.map((table, i) =>
				i === index && next.tables[i]
					? { ...table, rows: [...table.rows, ...next.tables[i].rows] }
					: table,
			),
			next_cursor: next.next_cursor,
		};
	}

	// 其余类型不支持分页（没有游标，本不该走到这里）
	return prev;
}

/** 拼查询串：首屏不带 cursor，续取带上（游标是不透明串，原样回传） */
export function previewUrlWithCursor(url: string, cursor?: string): string {
	if (!cursor) return url;
	return `${url}?cursor=${encodeURIComponent(cursor)}`;
}
