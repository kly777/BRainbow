// ── Office 文档预览：docx / xlsx 的渲染与失败提示 ──
//
// 解析在后端（见 src/modules/file/preview.rs），所以前端这里钉的是"拿到那份结构之后
// 怎么画"，以及三条容易坏的路：预览地址派生、类型对不上、后端报错要说给用户听。

import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewUrlOf } from "../hooks/usePreviewDoc.ts";
import { ArchiveViewer } from "./ArchiveViewer.tsx";
import { DatabaseViewer } from "./DatabaseViewer.tsx";
import { DocxViewer } from "./DocxViewer.tsx";
import { EpubViewer } from "./EpubViewer.tsx";
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

/** 按可见文案取按钮 */
function buttonByText(host: HTMLElement, label: string): HTMLButtonElement {
	const found = Array.from(host.querySelectorAll("button")).find((b) =>
		(b.textContent ?? "").includes(label),
	);
	if (!found) throw new Error(`找不到按钮「${label}」`);
	return found as HTMLButtonElement;
}

/** 按 aria-label 取按钮（图标按钮没有可读文案） */
function chapterButtonByAria(
	host: HTMLElement,
	label: string,
): HTMLButtonElement {
	const found = host.querySelector(`button[aria-label='${label}']`);
	if (!found) throw new Error(`找不到 aria-label 为「${label}」的按钮`);
	return found as HTMLButtonElement;
}

/** 按可见文案取按钮（不要用下标：外壳随时可能插入别的按钮） */
function chapterButton(host: HTMLElement, label: string): HTMLButtonElement {
	const found = Array.from(host.querySelectorAll("button")).find((b) =>
		(b.textContent ?? "").includes(label),
	);
	if (!found) throw new Error(`找不到按钮「${label}」`);
	return found as HTMLButtonElement;
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

beforeEach(() => {
	localStorage.clear();
});

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

		// 等"h1 已带文案"而不是"文本出现过"：innerHTML 由动态 import 的 DOMPurify 写入，
		// 两者抢跑时（并发跑全量时出现过）只等文本会在 h1 就位前通过
		await settle(() => host.querySelector("h1")?.textContent === "标题");
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

	it("「载入更多」带游标再请求，并把新行追加到当前表", async () => {
		const page1 = {
			kind: "sheet",
			truncated: false,
			next_cursor: "cursor-1",
			sheets: [
				{ name: "表一", rows: [["r1"], ["r2"]], total_rows: 4, total_cols: 1 },
			],
		};
		const page2 = {
			kind: "sheet",
			truncated: false,
			sheets: [
				{ name: "表一", rows: [["r3"], ["r4"]], total_rows: 4, total_cols: 1 },
			],
		};
		const spy = vi.fn(
			async (url: string) =>
				new Response(JSON.stringify(url.includes("cursor=") ? page2 : page1), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		vi.stubGlobal("fetch", spy);

		const host = mount(XlsxViewer);
		await settle(() => host.textContent?.includes("r2") ?? false);
		expect(host.textContent).toContain("已显示 2 行 / 共 4 行");

		buttonByText(host, "载入更多").click();
		await settle(() => host.textContent?.includes("r4") ?? false);

		// 第二页的行追加在后面（首屏那两行没被替换掉）
		expect(host.textContent).toContain("r1");
		expect(host.textContent).toContain("r4");
		// 请求确实带上了服务端给的游标
		expect(spy.mock.calls[1]?.[0]).toContain("cursor=cursor-1");
		// 取完（第二页没有 next_cursor）按钮就消失
		expect(host.textContent).not.toContain("载入更多");
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

describe("DatabaseViewer", () => {
	const table = (name: string, columns: string[], rows: string[][]) => ({
		name,
		columns,
		rows,
	});

	it("表头 + 数据行都铺出来，多张表给页签", async () => {
		stubPreview({
			kind: "database",
			tables: [
				table("user", ["id", "name"], [["1", "张三"]]),
				table("log", ["msg"], [["hello"]]),
			],
			truncated: false,
		});
		const host = mount(DatabaseViewer);

		await settle(() => (host.textContent ?? "").includes("张三"));
		expect(host.textContent).toContain("id");
		expect(host.textContent).toContain("name");
		expect(host.querySelectorAll("th").length).toBe(2);
		expect(host.textContent).not.toContain("hello");

		const tabs = host.querySelectorAll("[role='tab']");
		(tabs[1] as HTMLButtonElement).click();
		await settle(() => (host.textContent ?? "").includes("hello"));
		expect(host.textContent).toContain("msg");
	});

	it("说明这是只读预览（每张表最多 100 行）", async () => {
		stubPreview({
			kind: "database",
			tables: [table("user", ["id"], [["1"]])],
			truncated: false,
		});
		const host = mount(DatabaseViewer);
		await settle(() => (host.textContent ?? "").includes("只读预览"));
		expect(host.textContent).toContain("每张表最多 100 行");
	});

	it("表太多时说明只显示了前 50 张；空库给一句话", async () => {
		stubPreview({
			kind: "database",
			tables: [table("a", ["x"], [])],
			truncated: true,
		});
		const host = mount(DatabaseViewer);
		await settle(() => (host.textContent ?? "").includes("前 50 张"));

		stubPreview({ kind: "database", tables: [], truncated: false });
		const empty = mount(DatabaseViewer);
		await settle(() => (empty.textContent ?? "").includes("没有表"));
	});
});

describe("EpubViewer", () => {
	const book = {
		kind: "book" as const,
		title: "测试书",
		author: "某作者",
		chapters: [
			{ title: "第一章", html: "<h1>第一章</h1><p>正文一</p>" },
			{ title: "第二章", html: "<h1>第二章</h1><p>正文二</p>" },
		],
		truncated: false,
	};

	it("先显示第一章，翻页换章（不是页签）", async () => {
		stubPreview(book);
		const host = mount(EpubViewer);

		await settle(() => (host.textContent ?? "").includes("正文一"));
		// 书名 · 作者 · 章数
		expect(host.textContent).toContain("测试书 · 某作者 · 共 2 章");
		expect(host.textContent).not.toContain("正文二");

		chapterButton(host, "下一章").click();
		await settle(() => (host.textContent ?? "").includes("正文二"));
		expect(host.textContent).not.toContain("正文一");
	});

	it("第一章时「上一章」不可点，末章时「下一章」不可点", async () => {
		stubPreview(book);
		const host = mount(EpubViewer);
		await settle(() => (host.textContent ?? "").includes("正文一"));
		// 按文案选按钮而不是下标：外壳还可能插入别的按钮（如查找浮层的触发按钮），
		// 用 `querySelectorAll("button")[0]` 这种写法会被无关改动弄挂
		expect(chapterButton(host, "上一章").disabled).toBe(true);
		expect(chapterButton(host, "下一章").disabled).toBe(false);

		chapterButton(host, "下一章").click();
		await settle(() => (host.textContent ?? "").includes("正文二"));
		expect(chapterButton(host, "上一章").disabled).toBe(false);
		expect(chapterButton(host, "下一章").disabled).toBe(true);
	});

	it("章节被截断时说明只显示了前面的章节", async () => {
		stubPreview({ ...book, truncated: true });
		const host = mount(EpubViewer);
		await settle(() => (host.textContent ?? "").includes("正文一"));
		expect(host.textContent).toContain("只显示了前面的章节");
	});

	it("目录下拉可直接跳章（不必点几十次下一章）", async () => {
		stubPreview(book);
		const host = mount(EpubViewer);
		await settle(() => (host.textContent ?? "").includes("正文一"));

		const select = host.querySelector("select");
		expect(select).not.toBeNull();
		// 选项就是全部章节（带序号）
		const options = Array.from(host.querySelectorAll("option")).map(
			(o) => o.textContent,
		);
		expect(options).toEqual(["1. 第一章", "2. 第二章"]);

		(select as HTMLSelectElement).value = "1";
		select?.dispatchEvent(new Event("change", { bubbles: true }));
		await settle(() => (host.textContent ?? "").includes("正文二"));
		expect(host.textContent).toContain("正文二");
	});

	it("打开时接着上次的章节读（存档来自 localStorage）", async () => {
		localStorage.setItem(
			"file:book:s1",
			JSON.stringify({ chapter: 1, ratio: 0 }),
		);
		stubPreview(book);
		const host = mount(EpubViewer);

		await settle(() => (host.textContent ?? "").includes("正文二"));
		expect(host.textContent).toContain("正文二");
		expect(host.textContent).not.toContain("正文一");
		// 下拉也停在第二章
		expect((host.querySelector("select") as HTMLSelectElement).value).toBe("1");
	});

	it("越界的存档当作没有（书被换过就从头读）", async () => {
		localStorage.setItem(
			"file:book:s1",
			JSON.stringify({ chapter: 99, ratio: 0 }),
		);
		stubPreview(book);
		const host = mount(EpubViewer);

		await settle(() => (host.textContent ?? "").includes("正文一"));
		expect(host.textContent).toContain("正文一");
	});

	it("字号可调并记住（作用于正文容器的 font-size）", async () => {
		stubPreview(book);
		const host = mount(EpubViewer);
		await settle(() => (host.textContent ?? "").includes("正文一"));

		const body = host.querySelector("[class*='bookBody']") as HTMLElement;
		const before = body.style.fontSize;

		chapterButtonByAria(host, "放大正文字号").click();
		await Promise.resolve();
		const after = (host.querySelector("[class*='bookBody']") as HTMLElement)
			.style.fontSize;
		expect(after).not.toBe(before);
		expect(Number.parseFloat(after)).toBeGreaterThan(
			Number.parseFloat(before || "1"),
		);
		// 档位落盘（全局偏好，不随书）
		expect(localStorage.getItem("file:book:font-scale")).not.toBeNull();
	});
});
