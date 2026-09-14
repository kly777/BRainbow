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
import { codeLang, isPlainTextName } from "../lib/filename.ts";
import { AudioViewer } from "./AudioViewer.tsx";
import { CodeViewer } from "./CodeViewer.tsx";
import { CsvViewer } from "./CsvViewer.tsx";
import { HexViewer } from "./HexViewer.tsx";
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
	// ── other 类别（后端白名单外的格式）不再只有"下载"按钮 ──
	{
		// 字幕/歌词/日志这类：MIME 是 application/x-subrip 等非标准名，
		// 归入 other 类别，但内容就是文本 —— 按扩展名认出后照文本渲染
		id: "plain-text-name",
		match: (f) =>
			f.file_category === "other" && isPlainTextName(f.original_name),
		component: PlainTextViewer,
	},
	{
		// 其余二进制（压缩包/3D 模型/设计稿/未知格式）：看文件头认类型，
		// 至少能回答"这文件到底是什么"
		id: "hex",
		match: (f) => f.file_category === "other",
		component: HexViewer,
	},
];

/** 命中第一个匹配的查看器；undefined 表示"没有查看器"，由调用方渲染下载兜底 */
export function pickViewer(f: FileItem): Viewer | undefined {
	return VIEWERS.find((v) => v.match(f));
}
