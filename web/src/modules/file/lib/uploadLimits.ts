// ── 上传前的前端预校验：把"传了半天才被拒"变成"选完文件就知道" ──
//
// 唯一真相在后端 `src/modules/file/service.rs` 的分档常量（`IMAGE_MAX_SIZE` /
// `SVG_MAX_SIZE` / `AUDIO_MAX_SIZE` / `DOCUMENT_MAX_SIZE` / `FALLBACK_MAX_SIZE`、
// 白名单 `ALLOWED_MIMES`），这里是它的**镜像**：改后端分档必须同步改这里，
// `uploadLimits.test.ts` 会直接读后端源码比对，漏改会挂测试。
//
// 判断原则：**只拦明确超限的**。判不出类型就按 `other` 档（4GB）放行 ——
// 前端误判会直接把用户的文件挡在门外，漏放最多让后端再拒一次，代价小得多。

import type { FileCategory } from "../api.ts";

const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;

export interface UploadTier {
	category: FileCategory;
	/** 提示文案里的说法（界面统一说人话） */
	label: string;
	maxBytes: number;
}

/**
 * 校验只需要这三样。刻意不收 `File`：调用方传 File 天然满足，
 * 而测试能直接构造超大 `size`，不必真分配几百 MB。
 */
export interface UploadCandidate {
	name: string;
	type: string;
	size: number;
}

/** 分档表（值必须与后端一致，见文件头注释） */
export const UPLOAD_TIERS = {
	image: { category: "image", label: "图片", maxBytes: 200 * MIB },
	svg: { category: "image", label: "SVG", maxBytes: 20 * MIB },
	video: { category: "video", label: "视频", maxBytes: 4 * GIB },
	audio: { category: "audio", label: "音频", maxBytes: 1 * GIB },
	document: { category: "document", label: "文档", maxBytes: 500 * MIB },
	other: { category: "other", label: "其他文件", maxBytes: 4 * GIB },
} as const satisfies Record<string, UploadTier>;

export type TierKey = keyof typeof UPLOAD_TIERS;

/** 白名单 MIME → 档位。表外一律 other（与后端 `find_allowed` 的兜底一致） */
export const MIME_TIER: Record<string, TierKey> = {
	// 图片
	"image/png": "image",
	"image/jpeg": "image",
	"image/gif": "image",
	"image/webp": "image",
	"image/bmp": "image",
	"image/tiff": "image",
	// SVG 单独一档（XML 文本，浏览器要解析）
	"image/svg+xml": "svg",
	// 视频
	"video/mp4": "video",
	"video/webm": "video",
	"video/ogg": "video",
	"video/quicktime": "video",
	// 音频
	"audio/mpeg": "audio",
	"audio/ogg": "audio",
	"audio/wav": "audio",
	"audio/webm": "audio",
	"audio/flac": "audio",
	"audio/aac": "audio",
	// 文档
	"application/pdf": "document",
	"text/plain": "document",
	"text/html": "document",
	"text/csv": "document",
	"text/markdown": "document",
	"application/msword": "document",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		"document",
	"application/vnd.ms-excel": "document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		"document",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation":
		"document",
};

/**
 * 扩展名 → 档位：仅在浏览器不给 `file.type` 时兜底（`.ply` 这类未注册类型
 * 浏览器一律报空字符串）。`.ogg`/`.webm` 音视频共用扩展名，取**宽松**的 video 档，
 * 与上面"只拦明确超限"的原则一致。
 */
export const EXT_TIER: Record<string, TierKey> = {
	png: "image",
	jpg: "image",
	jpeg: "image",
	gif: "image",
	webp: "image",
	bmp: "image",
	tif: "image",
	tiff: "image",
	svg: "svg",
	mp4: "video",
	mov: "video",
	ogg: "video",
	webm: "video",
	mp3: "audio",
	wav: "audio",
	flac: "audio",
	aac: "audio",
	pdf: "document",
	txt: "document",
	html: "document",
	htm: "document",
	csv: "document",
	md: "document",
	pptx: "document",
	markdown: "document",
	doc: "document",
	docx: "document",
	xls: "document",
	xlsx: "document",
};

/** 扩展名（无扩展名或隐藏文件返回空串） */
function extensionOf(name: string): string {
	const lower = name.toLowerCase();
	const dot = lower.lastIndexOf(".");
	// dot <= 0 覆盖"没有点"和".gitignore 这类点开头的隐藏文件"
	return dot <= 0 ? "" : lower.slice(dot + 1);
}

/** 该文件适用的档位：浏览器 MIME → 扩展名 → other 档 */
export function uploadTierFor(file: UploadCandidate): UploadTier {
	const byMime = MIME_TIER[file.type.trim().toLowerCase()];
	if (byMime) return UPLOAD_TIERS[byMime];
	const byExt = EXT_TIER[extensionOf(file.name)];
	return UPLOAD_TIERS[byExt ?? "other"];
}

/** 字节数 → 人话（1024 进制，与后端分档口径一致） */
export function formatBytes(bytes: number): string {
	const scale = (value: number, unit: string) =>
		`${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`;
	if (bytes >= GIB) return scale(bytes / GIB, "GB");
	if (bytes >= MIB) return scale(bytes / MIB, "MB");
	if (bytes >= 1024) return scale(bytes / 1024, "KB");
	return `${bytes} B`;
}

/**
 * 上传前校验：通过返回 `null`，否则返回给用户看的拒绝原因。
 *
 * 只做两件能确定的事——空文件（后端必拒）与超出该档上限；
 * 类型真伪、魔数是否相符仍由后端裁定，前端不猜。
 */
export function validateUploadFile(file: UploadCandidate): string | null {
	if (file.size === 0) return "空文件（0 字节）无法上传";
	const tier = uploadTierFor(file);
	if (file.size > tier.maxBytes) {
		return `${tier.label}上限 ${formatBytes(tier.maxBytes)}，该文件 ${formatBytes(file.size)}`;
	}
	return null;
}
