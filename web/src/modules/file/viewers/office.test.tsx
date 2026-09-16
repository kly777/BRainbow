// ── Office 文档预览：docx / xlsx 的渲染与失败提示 ──
//
// 解析在后端（见 src/modules/file/preview.rs），所以前端这里钉的是"拿到那份结构之后
// 怎么画"，以及三条容易坏的路：预览地址派生、类型对不上、后端报错要说给用户听。

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewUrlOf } from "../hooks/usePreviewDoc.ts";
import { ArchiveViewer } from "./ArchiveViewer.tsx";
import { DocxViewer } from "./DocxViewer.tsx";
import { PptxViewer } from "./PptxViewer.tsx";
import { item } from "./test-fixtures.ts";
import { XlsxViewer } from "./XlsxViewer.tsx";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function mount(view: (props: { item: ReturnType<typeof item> }) => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(
		() =>
			// biome-ignore lint/suspicious/noExplicitAny: 测试里按组件签名直接调
			(view as any)({ item: item({ mime_type: "text/plain" }) }),
		host,
	);
	return host;
}

/** 让 fetch 返回一份预览 JSON（或一个错误状态码） */
function stubPreview(payload: unknown, status = 200) {
	const spy = vi.fn(
		async () =>
			new Response(JSON.stringify(payload), {
				status,
				headers: { "content-type": "application/json" },
			}),
	);
	vi.stubGlobal("fetch", spy);
	return spy;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("previewUrlOf", () => {
	it("由内容 URL 换成预览端点（前缀不动）", () => {
		expect(
			previewUrlOf(
				item({ url: "/api/file/abc123/data/%E6%8A%A5%E5%91%8A.docx" }),
			),
		).toBe("/api/file/abc123/preview");
	});

	it("形状对不上时返回 undefined（调用方给可读失败，而不是拼出一个坏 URL）", () => {
		expect(previewUrlOf(item({ url: "/api/file/abc123" }))).toBeUndefined();
		expect(
			previewUrlOf(item({ url: "https://x/y/data/z/extra" })),
		).toBeUndefined();
	});
});

describe("DocxViewer", () => {
	it("把后端给的受限 HTML 渲染出来（并过一次 DOMPurify）", async () => {
		stubPreview({
			kind: "docx",
			html: "<h1>标题</h1><p>正文<strong>加粗</strong></p>",
			truncated: false,
		});
		const host = mount(DocxViewer);

		await settle(() => (host.textContent ?? "").includes("标题"));
		expect(host.querySelector("h1")?.textContent).toBe("标题");
		expect(host.querySelector("strong")?.textContent).toBe("加粗");
		expect(host.textContent).not.toContain("正在解析");
	});

	it("危险标签进不来：脚本与事件属性都被 DOMPurify 清掉", async () => {
		// 正常路径下后端不会吐这些（它只发白名单标签、文本已转义），
		// 但这里是"万一后端被改坏"的最后一道防线，得钉住
		stubPreview({
			kind: "docx",
			html: '<p>安全</p><script>alert(1)</script><img src=x onerror="alert(2)">',
			truncated: false,
		});
		const host = mount(DocxViewer);

		await settle(() => (host.textContent ?? "").includes("安全"));
		expect(host.querySelector("script")).toBeNull();
		expect(host.querySelector("img")).toBeNull();
		expect(host.innerHTML).not.toContain("onerror");
	});

	it("被截断时说明只显示了开头", async () => {
		stubPreview({ kind: "docx", html: "<p>很长</p>", truncated: true });
		const host = mount(DocxViewer);
		await settle(() => (host.textContent ?? "").includes("很长"));
		expect(host.textContent).toContain("仅显示了开头部分");
	});

	it("后端报错时把原因显示出来，不停在加载态", async () => {
		stubPreview({ code: "INVALID_INPUT", message: "不是有效的 docx" }, 400);
		const host = mount(DocxViewer);
		await settle(() => (host.textContent ?? "").includes("预览失败"));
		expect(host.textContent).toContain("不是有效的 docx");
		expect(host.textContent).not.toContain("正在解析");
	});
});

describe("XlsxViewer", () => {
	const sheet = (name: string, rows: string[][], total = rows.length) => ({
		name,
		rows,
		total_rows: total,
		total_cols: rows[0]?.length ?? 0,
	});

	it("铺出单元格；多张表给页签，点一下就切过去", async () => {
		stubPreview({
			kind: "sheet",
			sheets: [
				sheet("第一张", [["姓名", "张三"]]),
				sheet("第二张", [["平台", "B站"]]),
			],
			truncated: false,
		});
		const host = mount(XlsxViewer);

		await settle(() => (host.textContent ?? "").includes("张三"));
		expect(host.textContent).toContain("姓名");
		expect(host.textContent).not.toContain("B站");
		const tabs = host.querySelectorAll("[role='tab']");
		expect(tabs.length).toBe(2);

		(tabs[1] as HTMLButtonElement).click();
		await settle(() => (host.textContent ?? "").includes("B站"));
		expect(host.textContent).toContain("平台");
		expect(host.textContent).not.toContain("张三");
	});

	it("只有一张表时不显示页签（少一层没用的东西）", async () => {
		stubPreview({
			kind: "sheet",
			sheets: [sheet("唯一", [["1", "2"]])],
			truncated: false,
		});
		const host = mount(XlsxViewer);
		await settle(
			() =>
				(host.textContent ?? "").includes("唯一") ||
				(host.textContent ?? "").includes("1"),
		);
		expect(host.querySelectorAll("[role='tab']").length).toBe(0);
	});

	it("行被截断时如实说明（含总行数）", async () => {
		stubPreview({
			kind: "sheet",
			sheets: [sheet("大表", [["1"], ["2"]], 3000)],
			truncated: true,
		});
		const host = mount(XlsxViewer);
		await settle(() => (host.textContent ?? "").includes("只显示了前"));
		expect(host.textContent).toContain("共 3000 行");
	});
});

describe("PptxViewer", () => {
	it("每页铺成卡片：页码、标题、正文与备注都在", async () => {
		stubPreview({
			kind: "slides",
			slides: [
				{ title: "封面", lines: [], notes: "" },
				{ title: "架构", lines: ["服务端解析", "前端只画"], notes: "讲稿一句" },
			],
			truncated: false,
		});
		const host = mount(PptxViewer);

		await settle(() => (host.textContent ?? "").includes("封面"));
		expect(host.textContent).toContain("第 1 页");
		expect(host.textContent).toContain("第 2 页");
		expect(host.textContent).toContain("服务端解析");
		expect(host.textContent).toContain("备注：讲稿一句");
	});

	it("没有标题的页给个占位，不留空白", async () => {
		stubPreview({
			kind: "slides",
			slides: [{ title: "", lines: ["只有正文"], notes: "" }],
			truncated: false,
		});
		const host = mount(PptxViewer);
		await settle(() => (host.textContent ?? "").includes("只有正文"));
		expect(host.textContent).toContain("（无标题）");
	});

	it("超过上限时说明只显示了前 100 张", async () => {
		stubPreview({
			kind: "slides",
			slides: [{ title: "一", lines: [], notes: "" }],
			truncated: true,
		});
		const host = mount(PptxViewer);
		await settle(() => (host.textContent ?? "").includes("一"));
		expect(host.textContent).toContain("只显示了前 100 张");
	});

	it("空演示文稿给一句话，而不是空白面板", async () => {
		stubPreview({ kind: "slides", slides: [], truncated: false });
		const host = mount(PptxViewer);
		await settle(() => (host.textContent ?? "").includes("没有幻灯片"));
	});
});

describe("ArchiveViewer", () => {
	it("列出条目、大小与压缩后大小，并给出汇总", async () => {
		stubPreview({
			kind: "archive",
			format: "zip",
			entries: [
				{ name: "src/main.rs", size: 2048, compressed_size: 512, dir: false },
				{ name: "docs/", size: 0, compressed_size: 0, dir: true },
			],
			truncated: false,
			total_bytes: 2048,
		});
		const host = mount(ArchiveViewer);

		await settle(() => (host.textContent ?? "").includes("src/main.rs"));
		expect(host.textContent).toContain("docs/");
		// 大小走 @shared/utils 的 formatBytes（具体写法由它决定，这里只钉"有大小"）
		expect(host.textContent).toContain("KB");
		expect(host.textContent).toContain("压缩后");
		// 汇总：格式 · 条目数 · 解压后大小
		expect(host.textContent).toContain("zip · 2 项");
		expect(host.textContent).toContain("目录");
	});

	it("超过 500 项时说明只列了前 500 项", async () => {
		stubPreview({
			kind: "archive",
			format: "tar.gz",
			entries: [{ name: "a", size: 1, compressed_size: 1, dir: false }],
			truncated: true,
			total_bytes: 1,
		});
		const host = mount(ArchiveViewer);
		await settle(() => (host.textContent ?? "").includes("tar.gz"));
		expect(host.textContent).toContain("只列了前 500 项");
	});

	it("空包给一句话，而不是空表格", async () => {
		stubPreview({
			kind: "archive",
			format: "zip",
			entries: [],
			truncated: false,
			total_bytes: 0,
		});
		const host = mount(ArchiveViewer);
		await settle(() => (host.textContent ?? "").includes("没有条目"));
	});
});
