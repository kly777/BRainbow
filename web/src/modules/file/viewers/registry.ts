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
import {
	codeLang,
	isArchiveName,
	isEpubName,
	isSqliteName,
} from "../lib/filename.ts";
import { modelFormatOf } from "../lib/model.ts";
import { isSplatLikeName } from "../lib/ply.ts";
import { isPointCloudName } from "../lib/pointcloud.ts";
import { ArchiveViewer } from "./ArchiveViewer.tsx";
import { AudioViewer } from "./AudioViewer.tsx";
import { CodeViewer } from "./CodeViewer.tsx";
import { CsvViewer } from "./CsvViewer.tsx";
import { DatabaseViewer } from "./DatabaseViewer.tsx";
import { DocxViewer } from "./DocxViewer.tsx";
import { EpubViewer } from "./EpubViewer.tsx";
import { HexViewer } from "./HexViewer.tsx";
import { HtmlViewer } from "./HtmlViewer.tsx";
import { ImageViewer } from "./ImageViewer.tsx";
import { MarkdownViewer } from "./MarkdownViewer.tsx";
import { ModelViewer } from "./ModelViewer.tsx";
import { PdfViewer } from "./PdfViewer.tsx";
import { PlainTextViewer } from "./PlainTextViewer.tsx";
import { PptxViewer } from "./PptxViewer.tsx";
import { SplatViewer } from "./SplatViewer.tsx";
import type { Viewer } from "./types.ts";
import { VideoViewer } from "./VideoViewer.tsx";
import { XlsxViewer } from "./XlsxViewer.tsx";

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
		// Office 文档：正文由**后端**解析成受限 HTML / 表格数据（前端没有可信的解析器，
		// 见 preview.rs 的文件头注释）。.doc 是二进制 OLE，暂不收录，仍然只给下载
		id: "docx",
		match: (f) =>
			f.mime_type ===
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		component: DocxViewer,
	},
	{
		id: "pptx",
		match: (f) =>
			f.mime_type ===
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		component: PptxViewer,
	},
	{
		id: "xlsx",
		match: (f) =>
			f.mime_type ===
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
			f.mime_type === "application/vnd.ms-excel",
		component: XlsxViewer,
	},
	// ── 按扩展名认领的几种格式：**必须排在下面的文本规则之前** ──
	// 它们的内容往往就是文本（ASCII 的 .ply / .stl / .obj / .gltf、.xyz 点云、
	// PCD 的 ascii 形态），后端会如实存成 text/plain —— 但"这是点云 / 网格 / 数据库"
	// 只有扩展名说得出口。让泛化的文本规则先命中，它们就会被渲染成一屏纯文本。
	{
		// 3D/点云：`.ply`（带 ASCII 头的高斯或点云）、`.splat`（参考实现的定长格式）、
		// `.pcd` / `.xyz` / `.pts`（PCL 与通用的点云）都走这个查看器 ——
		// 按扩展名认领，究竟是哪种由查看器按**内容**分辨（见 engine.ts 的 parseSplatBytes）。
		// 不是我认得的格式、或解析不动时，查看器自己给提示与下载入口
		id: "splat",
		match: (f) =>
			isSplatLikeName(f.original_name) || isPointCloudName(f.original_name),
		component: SplatViewer,
	},
	{
		// 电子书：后端按 spine 抽出各章（epub 也是 zip，所以内容判据在后端）
		id: "epub",
		match: (f) => isEpubName(f.original_name),
		component: EpubViewer,
	},
	{
		// 3D 模型（网格）：three.js 渲染，与泼溅查看器是两条不同的管线。
		// 按扩展名认领；`.ply` 留在泼溅查看器那边（它更可能是高斯/点云）
		id: "model",
		match: (f) => modelFormatOf(f.original_name) !== undefined,
		component: ModelViewer,
	},
	{
		// SQLite 数据库：只读列出表与前若干行（后端只读打开 + 上限 + 超时，
		// 见 preview.rs 的 parse_database —— 这是唯一一处会"打开用户上传文件"的地方）
		id: "database",
		match: (f) => isSqliteName(f.original_name),
		component: DatabaseViewer,
	},
	{
		// 压缩包：只看条目清单，不解压（内容判据在后端，见 preview.rs 的 sniff_container）
		id: "archive",
		match: (f) => isArchiveName(f.original_name),
		component: ArchiveViewer,
	},
	// ── 文本类：mime 精确匹配的排在上面，泛化规则排在这里 ──
	{
		// 源码/配置：后端把一切文本都存成 text/*，这里按扩展名认出语言走高亮。
		// 顺手解决了 .json / .ts / .go / .sh / .sql / .vue / Dockerfile 这批
		// 曾经被判成二进制、掉进十六进制预览的文件（见 mime.rs 的 looks_like_text）
		id: "code",
		match: (f) => isText(f) && codeLang(f.original_name) !== "",
		component: CodeViewer,
	},
	{
		id: "text",
		match: isText,
		component: PlainTextViewer,
	},
	{
		// 其余二进制（设计稿/未知格式）：看文件头认类型，
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
