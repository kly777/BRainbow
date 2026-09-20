// ── 内容缩略（纯函数直测 + 一条假 fetch 的取数路径） ──
//
// 这里锁的是"什么类型才去取内容"与"取回来的东西怎么变成几行字"：
// 判定错了会给每个文件都发请求（白花服务端 CPU），排版错了会把 HTML 标签、
// 二进制垃圾直接糊在卡片上。

import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileItem } from "../api.ts";
import type { DocPreview } from "../hooks/usePreviewDoc.ts";
import {
	clearThumbPreviewCache,
	coverOf,
	htmlLines,
	isCoverKind,
	loadThumbPreview,
	TEXT_LINES,
	TEXT_SNIPPET_BYTES,
	textSnippet,
	wantsDocThumb,
	wantsTextThumb,
} from "./thumbPreview.ts";

const item = (over: Partial<FileItem> = {}): FileItem => ({
	id: 1,
	stored_id: "abcdefgh1234",
	url: "/api/file/abcdefgh1234/data/x.txt",
	original_name: "x.txt",
	mime_type: "text/plain",
	file_category: "document",
	size_bytes: 1024,
	width: null,
	height: null,
	duration_ms: null,
	tags: [],
	meta: {},
	created_at: "2026-09-14T00:00:00+00:00",
	updated_at: "2026-09-14T00:00:00+00:00",
	missing: false,
	is_private: false,
	can_edit: true,
	...over,
});

afterEach(() => {
	clearThumbPreviewCache();
	vi.unstubAllGlobals();
});

describe("wantsTextThumb", () => {
	it("文本/代码（含 ASCII 的 .ply/.stl，后端就存成 text/plain）都去取片段", () => {
		expect(wantsTextThumb(item())).toBe(true);
		expect(wantsTextThumb(item({ mime_type: "text/x-rust" }))).toBe(true);
	});

	it("图片/二进制不取", () => {
		expect(wantsTextThumb(item({ mime_type: "image/png" }))).toBe(false);
		expect(wantsTextThumb(item({ mime_type: "application/pdf" }))).toBe(false);
	});

	it("私密与缺失不取（列表的请求不带凭据，且内容本来就不在）", () => {
		expect(wantsTextThumb(item({ is_private: true }))).toBe(false);
		expect(wantsTextThumb(item({ missing: true }))).toBe(false);
	});

	it("超大文本不取（日志几百 MB，取 1KB 也要先握手）", () => {
		expect(wantsTextThumb(item({ size_bytes: 100 * 1024 * 1024 }))).toBe(false);
	});
});

describe("wantsDocThumb", () => {
	it("office / 电子书 / 压缩包 / 数据库走 /preview", () => {
		for (const mime of [
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",
			"application/epub+zip",
			"application/vnd.sqlite3",
			"application/zip",
		]) {
			expect(wantsDocThumb(item({ mime_type: mime })), mime).toBe(true);
		}
	});

	it("PDF 与普通文本不做封面（PDF 要渲染器，文本走片段那条）", () => {
		expect(wantsDocThumb(item({ mime_type: "application/pdf" }))).toBe(false);
		expect(isCoverKind(item({ mime_type: "application/pdf" }))).toBe(false);
	});

	it("超过预览端点的 32MB 闸门就别白跑", () => {
		const docx =
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
		expect(
			wantsDocThumb(item({ mime_type: docx, size_bytes: 40 * 1024 * 1024 })),
		).toBe(false);
	});

	it("地址形状对不上（拿不到 /preview）时不做封面", () => {
		expect(
			wantsDocThumb(item({ mime_type: "application/zip", url: "weird" })),
		).toBe(false);
	});
});

describe("textSnippet", () => {
	it("取前几行、去掉空行", () => {
		expect(textSnippet("fn main() {\n\n  let a = 1;\n}\n")).toEqual([
			"fn main() {",
			"  let a = 1;",
			"}",
		]);
	});

	it("丢掉被 Range 截断的最后一行（没换行结尾就不算一行）", () => {
		expect(textSnippet("first\nsecond\nhalf-line-trunc")).toEqual([
			"first",
			"second",
		]);
	});

	it("清掉 ANSI 颜色等控制字符（日志里的乱码来源）", () => {
		const raw = "\u001b[31merror\u001b[0m: boom\nok\n";
		expect(textSnippet(raw)).toEqual(["[31merror[0m: boom", "ok"]);
	});

	it("制表符换成两个空格，行尾空白去掉", () => {
		expect(textSnippet("a\tb   \n")).toEqual(["a  b"]);
	});

	it("行数上限生效（上限比能看见的行数多，裁剪交给 CSS 的容器查询）", () => {
		const raw = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
		expect(textSnippet(raw)).toHaveLength(TEXT_LINES);
		expect(textSnippet(raw, 2)).toEqual(["line0", "line1"]);
		// 卡片格子放得下 ~9 行，3rem 方框放得下 ~4 行 —— 上限放宽不会让 DOM 爆掉
		expect(TEXT_LINES).toBeGreaterThanOrEqual(9);
	});
});

describe("htmlLines", () => {
	it("去掉标签与实体，按块级标签断行", () => {
		const html = "<p>第一段</p><p>第二段 &amp; 更多</p>";
		expect(htmlLines(html)).toEqual(["第一段", "第二段 & 更多"]);
	});

	it("script/style 里的内容不算正文", () => {
		const html = "<style>p{color:red}</style><p>正文</p>";
		expect(htmlLines(html)).toEqual(["正文"]);
	});
});

describe("coverOf", () => {
	it("docx：取段落前几行", () => {
		const preview = {
			kind: "docx",
			html: "<p>标题</p><p>正文一</p>",
			truncated: false,
		} as DocPreview;
		expect(coverOf(preview)).toEqual({
			kind: "cover",
			lines: ["标题", "正文一"],
		});
	});

	it("表格：前 4 行，列数按数据来（不浪费宽度）", () => {
		const preview = {
			kind: "sheet",
			truncated: false,
			sheets: [
				{
					name: "Sheet1",
					rows: [
						["a", "b", "c", "d"],
						["1", "2", "3", "4"],
						["5", "6", "7", "8"],
						["9", "10", "11", "12"],
						["x", "y", "z", "w"],
					],
					total_rows: 5,
					total_cols: 4,
				},
			],
		} as DocPreview;
		// 这份数据有 4 列 → cols=4，四列都留着（铺满宽度而不是只给 3 列）
		expect(coverOf(preview)).toEqual({
			kind: "sheet",
			cols: 4,
			rows: [
				["a", "b", "c", "d"],
				["1", "2", "3", "4"],
				["5", "6", "7", "8"],
				["9", "10", "11", "12"],
			],
		});
	});

	it("表格的列数上限：超宽的表格只取前 4 列", () => {
		const preview = {
			kind: "sheet",
			truncated: false,
			sheets: [
				{
					name: "Sheet1",
					rows: [["a", "b", "c", "d", "e", "f"]],
					total_rows: 1,
					total_cols: 6,
				},
			],
		} as DocPreview;
		const cover = coverOf(preview);
		expect(cover).toEqual({
			kind: "sheet",
			cols: 4,
			rows: [["a", "b", "c", "d"]],
		});
	});

	it("单列表格只给 1 列（铺 3 列会浪费 2/3 宽度）", () => {
		const preview = {
			kind: "sheet",
			truncated: false,
			sheets: [
				{
					name: "Sheet1",
					rows: [["只有一列"], ["第二行"]],
					total_rows: 2,
					total_cols: 1,
				},
			],
		} as DocPreview;
		expect(coverOf(preview)).toEqual({
			kind: "sheet",
			cols: 1,
			rows: [["只有一列"], ["第二行"]],
		});
	});

	it("幻灯片 / 电子书 / 数据库 / 压缩包各取最能辨认的几行", () => {
		expect(
			coverOf({
				kind: "slides",
				truncated: false,
				slides: [
					{ title: "封面", lines: [], notes: "" },
					{ title: "方法", lines: [], notes: "" },
				],
			} as DocPreview),
		).toEqual({ kind: "cover", lines: ["封面", "方法"] });

		expect(
			coverOf({
				kind: "book",
				title: "老人与海",
				author: "海明威",
				chapters: [{ title: "第一章", html: "" }],
				truncated: false,
			} as DocPreview),
		).toEqual({ kind: "cover", lines: ["老人与海", "第一章"] });

		expect(
			coverOf({
				kind: "database",
				truncated: false,
				tables: [{ name: "user", columns: [], rows: [] }],
			} as DocPreview),
		).toEqual({ kind: "cover", lines: ["user"] });

		expect(
			coverOf({
				kind: "archive",
				format: "zip",
				truncated: false,
				total_bytes: 10,
				entries: [
					{ name: "readme.md", size: 1, compressed_size: 1, dir: false },
				],
			} as DocPreview),
		).toEqual({ kind: "cover", lines: ["readme.md"] });
	});

	it("空内容给 undefined（调用方继续显示后缀徽章）", () => {
		expect(
			coverOf({ kind: "sheet", truncated: false, sheets: [] } as DocPreview),
		).toBeUndefined();
		expect(
			coverOf({ kind: "docx", html: "", truncated: false } as DocPreview),
		).toBeUndefined();
	});
});

describe("loadThumbPreview", () => {
	it("文本走 Range 只取头部", async () => {
		let seen: RequestInit | undefined;
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			seen = init;
			return new Response("line one\nline two\n", { status: 206 });
		});
		vi.stubGlobal("fetch", fetchMock);

		const got = await new Promise<unknown>((resolve) =>
			loadThumbPreview(item(), (preview) => resolve(preview)),
		);

		expect(got).toEqual({ kind: "text", lines: ["line one", "line two"] });
		const range = seen
			? (seen.headers as Record<string, string>).Range
			: undefined;
		expect(range).toBe(`bytes=0-${TEXT_SNIPPET_BYTES - 1}`);
	});

	it("office 走 /preview 并把 JSON 变成封面", async () => {
		const docx =
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
		let askedUrl = "";
		const fetchMock = vi.fn(async (url: string) => {
			askedUrl = url;
			return new Response(
				JSON.stringify({ kind: "docx", html: "<p>甲方</p>", truncated: false }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const got = await new Promise<unknown>((resolve) =>
			loadThumbPreview(
				item({
					mime_type: docx,
					url: "/api/file/abcdefgh1234/data/合同.docx",
					original_name: "合同.docx",
				}),
				(preview) => resolve(preview),
			),
		);

		expect(got).toEqual({ kind: "cover", lines: ["甲方"] });
		expect(askedUrl).toBe("/api/file/abcdefgh1234/preview");
	});

	it("失败就是没有（不抛错、不影响列表），且结果会被缓存不再重试", async () => {
		const fetchMock = vi.fn(
			async (_url: string, _init?: RequestInit) =>
				new Response("nope", { status: 500 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const first = await new Promise<unknown>((resolve) =>
			loadThumbPreview(item(), (preview) => resolve(preview)),
		);
		expect(first).toBeUndefined();

		await new Promise<unknown>((resolve) =>
			loadThumbPreview(item(), (preview) => resolve(preview)),
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("不关这个类型的文件一次请求都不发", async () => {
		const fetchMock = vi.fn(
			async (_url: string, _init?: RequestInit) => new Response("x"),
		);
		vi.stubGlobal("fetch", fetchMock);

		const called = await new Promise<boolean>((resolve) => {
			loadThumbPreview(item({ mime_type: "image/png" }), () => resolve(true));
			setTimeout(() => resolve(false), 5);
		});

		expect(called).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
