// ── 查看器注册表：唯一的"哪个文件用哪个组件看"判定 ──
//
// 加一个文件类型的预览 = 往 VIEWERS 里加一条 + 写一个查看器组件。
// 兜底（"下载"面板）由 pickViewer 返回 undefined 派生，不再需要手写
// "不是以上任何一种"的负向条件——那种写法在加类型时漏改不会有任何报错。
//
// match 只看 mime 与文件名，不看 file_category：后者只有 5 个值
// （image/video/audio/document/other），既区分不了同属 document 的
// pdf/csv/docx，也表达不了"哪些格式浏览器其实渲染不了"这类事实。

import type { FileItem } from "../api.ts";
import { codeLang } from "../lib/filename.ts";
import { AudioViewer } from "./AudioViewer.tsx";
import { CodeViewer } from "./CodeViewer.tsx";
import { CsvViewer } from "./CsvViewer.tsx";
import { HtmlViewer } from "./HtmlViewer.tsx";
import { ImageViewer } from "./ImageViewer.tsx";
import { MarkdownViewer } from "./MarkdownViewer.tsx";
import { PdfViewer } from "./PdfViewer.tsx";
import { PlainTextViewer } from "./PlainTextViewer.tsx";
import type { Viewer } from "./types.ts";
import { VideoViewer } from "./VideoViewer.tsx";

const isText = (f: FileItem) => f.mime_type.startsWith("text/");

/**
 * 顺序即优先级：**取第一个命中的**。泛化规则（如 text/*）要排在具体规则之后。
 */
export const VIEWERS: Viewer[] = [
	{
		id: "image",
		match: (f) => f.file_category === "image",
		component: ImageViewer,
	},
	{
		id: "video",
		match: (f) => f.file_category === "video",
		component: VideoViewer,
	},
	{
		id: "audio",
		match: (f) => f.file_category === "audio",
		component: AudioViewer,
	},
	{
		id: "pdf",
		match: (f) => f.mime_type === "application/pdf",
		component: PdfViewer,
	},
	// ── 文本类：按 mime 精确匹配排在前，扩展名兜底（源码/配置）与纯文本排在后 ──
	{
		id: "markdown",
		match: (f) => f.mime_type === "text/markdown",
		component: MarkdownViewer,
	},
	{
		id: "html",
		match: (f) => f.mime_type === "text/html",
		component: HtmlViewer,
	},
	{
		id: "csv",
		match: (f) => f.mime_type === "text/csv",
		component: CsvViewer,
	},
	{
		// 源码/配置：后端对 .rs/.toml 这类只给 text/plain，靠扩展名认出语言走高亮
		id: "code",
		match: (f) => isText(f) && codeLang(f.original_name) !== "",
		component: CodeViewer,
	},
	{
		id: "text",
		match: isText,
		component: PlainTextViewer,
	},
];

/** 命中第一个匹配的查看器；undefined 表示"没有查看器"，由调用方渲染下载兜底 */
export function pickViewer(f: FileItem): Viewer | undefined {
	return VIEWERS.find((v) => v.match(f));
}
