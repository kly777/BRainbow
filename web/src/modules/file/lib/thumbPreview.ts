// ── 非图片文件的"内容缩略"（纯函数 + 有限并发的取数，直测） ──
//
// 网格里 PDF/压缩包/代码/表格长得一模一样（都是"彩色底 + 后缀徽章"），
// 找东西只能逐个读文件名。这里给能便宜取到内容的类型做一张小预览：
//
// - **文本/代码**：Range 取前 1KB，渲染成等宽小字（几十毫秒、几 KB）；
//   其中 **HTML 单开一路**：取 4KB 并优先提取元信息（标题 / 来源 URL / 描述），
//   因为保存下来的网页开头全是标记与内联样式，按原始文本取前几行看不到重点；
// - **office / 电子书 / 压缩包 / 数据库**：复用已有的 `/preview` JSON，
//   取前几行段落/单元格/条目名。
//
// 取不动的（PDF 要渲染器、二进制要解码）就保持后缀徽章 —— 这条是"尽力而为"，
// 不是"必须显示"：任何一步失败都静默退回徽章。

import type { FileItem } from "../api.ts";
import type { DocPreview } from "../hooks/usePreviewDoc.ts";
import { previewUrlOf } from "../hooks/usePreviewDoc.ts";

/** 文本缩略的渲染行数上限。
 *
 *  比"能看见的行数"多：卡片格子里能放下 ~9 行，列表行的 3rem 方框里只放得下 ~9 行
 *  的一半 —— 收纳由 CSS 的容器查询裁剪，这里给足即可（数据本来就在手里：1KB 有几十行）。 */
export const TEXT_LINES = 12;
/** 表格缩略的行数上限（行高用 1fr 撑满，格子再小就看不清了） */
export const SHEET_ROWS = 4;
/** 列数上限：以数据实际列数为准（单列表格按 3 列排就是浪费宽度），但不超这个数 */
export const SHEET_COLS_MAX = 4;
/** 取多少字节做文本缩略：6 行 80 列的代码也就 1KB 上下 */
export const TEXT_SNIPPET_BYTES = 1024;
/** 超过这个体积的文本就不去取片段了（日志动辄几百 MB，取 1KB 也要握手一次） */
export const TEXT_MAX_BYTES = 8 * 1024 * 1024;

/** 列表里展示的内容缩略（判别字段顺便决定怎么排版） */
export type ThumbPreview =
	| { kind: "text"; lines: string[] }
	| { kind: "cover"; lines: string[] }
	/** `cols` 给 CSS 决定网格列数（按数据来，铺满宽度） */
	| { kind: "sheet"; rows: string[][]; cols: number };

/** 文本/代码：走 Range 取头部 */
export function wantsTextThumb(item: FileItem): boolean {
	return (
		!item.missing &&
		!item.is_private &&
		item.mime_type.startsWith("text/") &&
		item.size_bytes > 0 &&
		item.size_bytes <= TEXT_MAX_BYTES
	);
}

/** office / 电子书 / 压缩包 / 数据库：走 `/preview`（服务端解析，前端只取前几行） */
const DOC_COVER_KINDS = [
	"docx",
	"sheet",
	"slides",
	"book",
	"database",
	"archive",
] as const;

export function wantsDocThumb(item: FileItem): boolean {
	if (item.missing || item.is_private || !previewUrlOf(item)) return false;
	// 与后端预览端点同一档闸门（超过 32MB 那边直接 400，别白跑一趟）
	if (item.size_bytes > 32 * 1024 * 1024) return false;
	return isCoverKind(item);
}

/** 只看 mime，判断"这个类型有没有 cover 可做"（供上面的判定与测试共用） */
export function isCoverKind(item: FileItem): boolean {
	const mime = item.mime_type;
	return DOC_COVER_KINDS.some((kind) => mime.includes(COVER_KIND_MATCH[kind]));
}

/** 各 cover 类型在 mime 里的可辨认片段（office 是 OOXML 的长 MIME） */
const COVER_KIND_MATCH: Record<(typeof DOC_COVER_KINDS)[number], string> = {
	docx: "wordprocessingml",
	sheet: "spreadsheetml",
	slides: "presentationml",
	book: "epub",
	database: "sqlite",
	archive: "zip",
};

/**
 * 原始文本片段 → 展示用行。
 *
 * 截断的尾巴（Range 只取 1KB）要丢掉：最后一行往往是半个词/半个多字节字符，
 * 显示出来像乱码。控制字符（ANSI 颜色、退格、NUL）一并清掉。
 */
export function textSnippet(raw: string, lineCount = TEXT_LINES): string[] {
	const cleaned = stripControlChars(raw).replace(/\r\n?/g, "\n").split("\n");
	// 最后一行可能被截断（没有换行结尾就丢）
	const whole = cleaned.length > 1 ? cleaned.slice(0, -1) : cleaned;
	return whole
		.map((line) => line.replace(/\t/g, "  ").trimEnd())
		.filter((line) => line.trim() !== "")
		.slice(0, lineCount);
}

/**
 * 控制字符过滤（保留 `\n` 与 `\t`）。
 * 按码点判断而不是写正则字符类：biome 禁止在正则里出现控制字符范围。
 */
function stripControlChars(input: string): string {
	return Array.from(input)
		.filter((ch) => {
			const code = ch.codePointAt(0) ?? 0;
			if (code === 0x09 || code === 0x0a) return true;
			// C0（\t \n 之外）与 DEL/C1 一律去掉
			return code >= 0x20 && (code < 0x7f || code > 0x9f);
		})
		.join("");
}

/** 常见实体解码（够用就好：内容缩略只需要可读） */
function decodeEntities(text: string): string {
	return text
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}

/**
 * 丢掉 Range 窗口截断处读不完整的东西。
 *
 * ① 开了没闭合的 `<style>`/`<script>`/`<title>`：正则配不到闭合标签，里面的 CSS/JS
 *    会被当成正文读出来。真实事故：保存页里 Emotion 注入的 `<style data-emotion=…>`
 *    横跨 4KB 窗口边界，卡片缩略上出现一长串 `@keyframes animation-xykzx5{…}`。
 * ② 结尾那半个标签（窗口正好切在 `<meta charset="u` 中间）同样是标记，不该显示。
 *
 * 判据是"读不完整"：内容一直延续到窗口外，其后没有可读的文字了，从截断处整段丢掉。
 */
function dropTruncatedTail(html: string): string {
	let cut = html.length;
	for (const tag of ["style", "script", "title"] as const) {
		const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
		const close = new RegExp(`</${tag}\\s*>`, "i");
		for (const m of html.matchAll(open)) {
			const start = m.index ?? 0;
			if (close.test(html.slice(start + m[0].length))) continue;
			cut = Math.min(cut, start);
			break;
		}
	}
	const rest = html.slice(0, cut);
	const lastOpen = rest.lastIndexOf("<");
	return rest.lastIndexOf(">") < lastOpen ? rest.slice(0, lastOpen) : rest;
}

/** docx 的 `html` → 段落文字（够用就好：去掉标签与常见实体，取前几行） */
export function htmlLines(html: string, lineCount = TEXT_LINES): string[] {
	const text = decodeEntities(
		dropTruncatedTail(html)
			.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
			.replace(/<br\s*\/?>/gi, "\n")
			// title/head 也断行：整页 HTML 走这条兜底时，`<title>` 里的文字不该和正文粘一起
			.replace(/<\/(p|div|h[1-6]|li|tr|title|head|ul|ol|table)>/gi, "\n")
			.replace(/<[^>]*>/g, ""),
	);
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.slice(0, lineCount);
}

/** 解析标签里的属性（`name=value` / 引号包裹 / 裸值都认；只取开头这一段） */
function parseAttrs(tag: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of tag.matchAll(
		/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
	)) {
		out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
	}
	return out;
}

/** `<meta name=KEY content=…>` / `<meta property=KEY …>` 的 content（属性顺序无关） */
function metaContent(html: string, key: string): string | undefined {
	const wanted = key.toLowerCase();
	for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
		const attrs = parseAttrs(tag[0]);
		const name = (attrs.name ?? attrs.property ?? "").toLowerCase();
		if (name === wanted && attrs.content) return attrs.content;
	}
	return undefined;
}

/** `<link rel=REL href=…>` 的 href */
function linkHref(html: string, rel: string): string | undefined {
	const wanted = rel.toLowerCase();
	for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
		const attrs = parseAttrs(tag[0]);
		if ((attrs.rel ?? "").toLowerCase() === wanted && attrs.href) {
			return attrs.href;
		}
	}
	return undefined;
}

/** 保存工具的注释里带的来源 URL（SingleFile 会写 `url: …`） */
function archivedSourceUrl(html: string): string | undefined {
	return html.match(
		/<!--[\s\S]{0,600}?SingleFile[\s\S]{0,400}?url:\s*(\S+)/i,
	)?.[1];
}

/** 取某个标签的全部文本（内层标签一并去掉） */
function tagTexts(html: string, tag: string, limit = 2): string[] {
	const out: string[] = [];
	for (const m of html.matchAll(
		new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi"),
	)) {
		out.push(decodeEntities(m[1].replace(/<[^>]*>/g, "")).replace(/\s+/g, " "));
		if (out.length >= limit) break;
	}
	return out;
}

/** HTML 缩略取多少字节：元信息几乎都在文档最前面，但保存下来的页面开头常带着
 *  一段注释与若干 meta，留 4KB 比 1KB 稳（多要 3KB 的成本可以忽略） */
export const HTML_SNIPPET_BYTES = 4096;

/** 这个文件的缩略要不要走 HTML 元信息提取（而不是按原始文本取前几行） */
export function isHtmlFile(item: FileItem): boolean {
	return item.mime_type === "text/html" || /\.html?$/i.test(item.original_name);
}

/**
 * HTML 文件的缩略：**优先元信息**（标题 → 来源 URL → 描述），再退回可见文字。
 *
 * 为什么单开一路：保存下来的网页（SingleFile 之类）开头就是一大堆标记与内联样式，
 * 按原始文本取前几行只会看到 `<!DOCTYPE html>`、`<meta …>`、`<style>…` —— 看不到重点。
 * 这几项元信息都在文档最前面，4KB 的窗口基本够；实在没有就退回 `htmlLines` 的正文文字。
 */
export function htmlMetaLines(html: string, lineCount = TEXT_LINES): string[] {
	const lines: string[] = [];
	const push = (value: string | undefined) => {
		const text = value ? decodeEntities(value).replace(/\s+/g, " ").trim() : "";
		if (text && !lines.includes(text)) lines.push(text);
	};

	push(tagTexts(html, "title", 1)[0]);
	// 来源 URL：先是保存工具的注释，其次是 canonical / og:url（谁先有就用谁）
	push(
		archivedSourceUrl(html) ??
			linkHref(html, "canonical") ??
			metaContent(html, "og:url"),
	);
	push(metaContent(html, "description") ?? metaContent(html, "og:description"));
	// 可见的小标题（窗口里能读到的）
	for (const heading of tagTexts(html, "h1")) push(heading);
	for (const heading of tagTexts(html, "h2")) push(heading);
	// 还不够就退回正文文字：先去掉整个 `<head>`（标题/描述/样式那些已经单独取过了，
	// 留着它们会让正文第一行变成"标题+正文"粘在一起）
	if (lines.length < lineCount) {
		const body = html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");
		for (const line of htmlLines(body, lineCount)) push(line);
	}
	return lines.slice(0, lineCount);
}

/**
 * `/preview` 的 JSON → 列表封面（纯函数）。
 *
 * 每种类型取最能辨认的几行：docx 取段落、表格取前几格、幻灯片取标题、
 * 电子书取章节名、压缩包取条目名、数据库取表名。给不出就 undefined（退徽章）。
 */
export function coverOf(preview: DocPreview): ThumbPreview | undefined {
	switch (preview.kind) {
		case "docx": {
			const lines = htmlLines(preview.html);
			return lines.length > 0 ? { kind: "cover", lines } : undefined;
		}
		case "sheet": {
			const sheet = preview.sheets[0];
			if (!sheet || sheet.rows.length === 0) return undefined;
			// 列数按数据来（单列表格铺 3 列会浪费掉 2/3 宽度），但不超上限
			const cols = Math.max(
				1,
				Math.min(SHEET_COLS_MAX, ...sheet.rows.map((row) => row.length)),
			);
			const rows = sheet.rows
				.slice(0, SHEET_ROWS)
				.map((row) => row.slice(0, cols).map((cell) => cell.trim()));
			return rows.length > 0 ? { kind: "sheet", rows, cols } : undefined;
		}
		case "slides": {
			const lines = preview.slides
				.map((slide) => slide.title.trim())
				.filter((t) => t !== "")
				.slice(0, TEXT_LINES);
			return lines.length > 0 ? { kind: "cover", lines } : undefined;
		}
		case "book": {
			const lines = [preview.title, ...preview.chapters.map((c) => c.title)]
				.map((t) => t.trim())
				.filter((t) => t !== "")
				.slice(0, TEXT_LINES);
			return lines.length > 0 ? { kind: "cover", lines } : undefined;
		}
		case "database": {
			const lines = preview.tables
				.map((t) => t.name.trim())
				.filter((t) => t !== "")
				.slice(0, TEXT_LINES);
			return lines.length > 0 ? { kind: "cover", lines } : undefined;
		}
		case "archive": {
			const lines = preview.entries
				.slice(0, TEXT_LINES)
				.map((e) => e.name.trim())
				.filter((t) => t !== "");
			return lines.length > 0 ? { kind: "cover", lines } : undefined;
		}
	}
}

// ── 取数：缓存 + 去重 + 限并发 ──
//
// 为什么不搞 IntersectionObserver：一页最多 24 条，**并发限制 2** 就已经把
// 服务端的解析压力摊平了（那才是真成本：docx/xlsx 是 spawn_blocking 里的 CPU 活）；
// 而"看不见的卡片也取了"的代价不过是几 KB 的 Range 请求，浏览器与模块缓存会吃掉重复。

const MAX_CONCURRENT = 2;
/** 结果缓存；`null` 表示"取过了，没有"（避免每次重渲染都再试一遍） */
const cache = new Map<string, ThumbPreview | null>();
const inFlight = new Map<string, Promise<ThumbPreview | undefined>>();

let active = 0;
const slots: (() => void)[] = [];

/** 限并发的槽位（先进先出） */
async function withSlot<T>(task: () => Promise<T>): Promise<T> {
	if (active >= MAX_CONCURRENT) {
		await new Promise<void>((resolve) => slots.push(resolve));
	}
	active += 1;
	try {
		return await task();
	} finally {
		active -= 1;
		slots.shift()?.();
	}
}

/** 缓存键：内容会变（同名不同内容）时要重新取，所以带上内容哈希/大小 */
function cacheKey(item: FileItem): string {
	return `${item.stored_id}:${item.content_hash ?? item.size_bytes}`;
}

/** 取文本片段（Range 只要头部；服务端不支持 Range 也能拿到完整文本，前端再截） */
async function fetchTextThumb(
	item: FileItem,
	signal: AbortSignal,
): Promise<ThumbPreview | undefined> {
	// HTML 走元信息提取（标题/来源 URL/描述），窗口也放宽一点 ——
	// 保存下来的网页开头全是标记与内联样式，按原始文本取前几行看不到重点
	const html = isHtmlFile(item);
	const bytes = html ? HTML_SNIPPET_BYTES : TEXT_SNIPPET_BYTES;
	const res = await fetch(item.url, {
		headers: { Range: `bytes=0-${bytes - 1}` },
		signal,
	});
	if (!res.ok && res.status !== 206) return undefined;
	const text = new TextDecoder().decode(await res.arrayBuffer());
	const lines = html ? htmlMetaLines(text) : textSnippet(text);
	return lines.length > 0 ? { kind: "text", lines } : undefined;
}

/** 取 office 封面（复用已有的 /preview JSON；后端解析，前端只取前几行） */
async function fetchDocThumb(
	item: FileItem,
	signal: AbortSignal,
): Promise<ThumbPreview | undefined> {
	const url = previewUrlOf(item);
	if (!url) return undefined;
	const res = await fetch(url, { signal });
	if (!res.ok) return undefined;
	const preview = (await res.json()) as DocPreview;
	return coverOf(preview);
}

/**
 * 取这个文件的列表缩略（没有就 undefined）。结果进模块级缓存，失败缓存为 null。
 *
 * **任何失败都不影响列表**：取不到就是没有，调用方继续显示后缀徽章。
 */
export function loadThumbPreview(
	item: FileItem,
	onReady: (preview: ThumbPreview | undefined) => void,
): () => void {
	const text = wantsTextThumb(item);
	const doc = !text && wantsDocThumb(item);
	if (!text && !doc) return () => {};

	const key = cacheKey(item);
	if (cache.has(key)) {
		onReady(cache.get(key) ?? undefined);
		return () => {};
	}

	const controller = new AbortController();
	let cancelled = false;

	let pending = inFlight.get(key);
	if (!pending) {
		pending = withSlot(() =>
			text
				? fetchTextThumb(item, controller.signal)
				: fetchDocThumb(item, controller.signal),
		)
			.catch(() => undefined)
			.then((preview) => {
				// 失败也缓存（null），否则每次重渲染都会再打一次注定失败的请求
				cache.set(key, preview ?? null);
				inFlight.delete(key);
				return preview;
			});
		inFlight.set(key, pending);
	}

	pending.then((preview) => {
		if (!cancelled) onReady(preview);
	});

	return () => {
		cancelled = true;
		// 共享的在途请求不在这里 abort：可能还有别的卡片在等同一个结果
	};
}

/** 清理缓存（测试用；正常路径靠 LRU 之外的"进程内一直留着"策略 —— 数量等于文件数） */
export function clearThumbPreviewCache(): void {
	cache.clear();
	inFlight.clear();
}
