// ── 预览分页的客户端合并（纯函数） ──
//
// 契约（见 doc/ux/file-preview-plan.md 的 P3-1）：游标请求返回同一套 schema，只有被
// 游标指定的那个容器从偏移处给行。所以合并规则是"**只追加到那个容器**，其余保持不动"。

import { describe, expect, it } from "vitest";
import type { DocPreview } from "../hooks/usePreviewDoc.ts";
import { hasMore, mergePage, previewUrlWithCursor } from "./previewPaging.ts";

const sheetPage = (rows: string[][], cursor?: string): DocPreview => ({
	kind: "sheet",
	truncated: false,
	next_cursor: cursor,
	sheets: [
		{ name: "第一张", rows, total_rows: 500, total_cols: 2 },
		{ name: "第二张", rows: [["x"]], total_rows: 1, total_cols: 1 },
	],
});

describe("hasMore", () => {
	it("有游标才算还有更多", () => {
		expect(hasMore(sheetPage([["1"]], "abc"))).toBe(true);
		expect(hasMore(sheetPage([["1"]]))).toBe(false);
		expect(hasMore(undefined)).toBe(false);
	});

	it("没有游标字段的类型（docx）不算", () => {
		expect(hasMore({ kind: "docx", html: "<p>x</p>", truncated: true })).toBe(
			false,
		);
	});
});

describe("mergePage", () => {
	it("把新一页追加到指定容器，并采用新游标", () => {
		const prev = sheetPage([["1"], ["2"]], "cursor-1");
		const next = sheetPage([["3"], ["4"]], "cursor-2");

		const merged = mergePage(prev, next, 0);
		if (merged.kind !== "sheet") throw new Error("类型不该变");
		expect(merged.sheets[0].rows).toEqual([["1"], ["2"], ["3"], ["4"]]);
		expect(merged.next_cursor).toBe("cursor-2");
		// 总行数不受分页影响（服务端如实给）
		expect(merged.sheets[0].total_rows).toBe(500);
	});

	it("只动指定容器：另一张表保持原样（不把它的第一页重复追加）", () => {
		const prev = sheetPage([["1"]], "cursor-1");
		const next: DocPreview = {
			kind: "sheet",
			truncated: false,
			next_cursor: "cursor-2",
			sheets: [
				{ name: "第一张", rows: [["9"]], total_rows: 500, total_cols: 2 },
				{ name: "第二张", rows: [["y"]], total_rows: 1, total_cols: 1 },
			],
		};
		const merged = mergePage(prev, next, 1);
		if (merged.kind !== "sheet") throw new Error("类型不该变");
		expect(merged.sheets[0].rows).toEqual([["1"]]);
		expect(merged.sheets[1].rows).toEqual([["x"], ["y"]]);
	});

	it("取完了就没有游标（按钮据此消失）", () => {
		const merged = mergePage(sheetPage([["1"]], "c1"), sheetPage([["2"]]), 0);
		expect(hasMore(merged)).toBe(false);
	});

	it("数据库表同理", () => {
		const prev: DocPreview = {
			kind: "database",
			truncated: false,
			next_cursor: "c1",
			tables: [{ name: "t", columns: ["id"], rows: [["1"]] }],
		};
		const next: DocPreview = {
			kind: "database",
			truncated: false,
			tables: [{ name: "t", columns: ["id"], rows: [["2"]] }],
		};
		const merged = mergePage(prev, next, 0);
		if (merged.kind !== "database") throw new Error("类型不该变");
		expect(merged.tables[0].rows).toEqual([["1"], ["2"]]);
	});

	it("类型不一致时原样返回（不该发生，但别崩）", () => {
		const prev = sheetPage([["1"]], "c1");
		const next: DocPreview = {
			kind: "docx",
			html: "<p>x</p>",
			truncated: false,
		};
		expect(mergePage(prev, next, 0)).toBe(prev);
	});

	it("不支持分页的类型原样返回", () => {
		const prev: DocPreview = {
			kind: "archive",
			format: "zip",
			entries: [],
			truncated: false,
			total_bytes: 0,
		};
		expect(mergePage(prev, prev, 0)).toBe(prev);
	});
});

describe("previewUrlWithCursor", () => {
	it("首屏不带参数，续取带上（游标要 URL 编码）", () => {
		expect(previewUrlWithCursor("/api/file/a/preview")).toBe(
			"/api/file/a/preview",
		);
		expect(previewUrlWithCursor("/api/file/a/preview", "7b226b")).toBe(
			"/api/file/a/preview?cursor=7b226b",
		);
		expect(previewUrlWithCursor("/api/file/a/preview", "a+b/c")).toBe(
			"/api/file/a/preview?cursor=a%2Bb%2Fc",
		);
	});
});
