// ── 列表侧的"能不能直接显示"判定（卡片/列表行/选择器/灯箱共用一处） ──
//
// 原先这三处各写一遍 `file_category === "image"`。用类别判断有两个问题：
// 一是 image 类别里含浏览器渲染不了的格式（TIFF 只有 Safari 支持）→ 列表里是破图；
// 二是以后要给视频出海报帧、给 PDF 出首页缩略图时，判定与渲染得同时改好几处。
//
// 这里是纯判定（无 DOM），渲染在 components/FileThumb.tsx 里做一次。

import type { FileItem } from "../api.ts";

/**
 * 浏览器能在 `<img>` 里渲染的图片类型。
 * TIFF 不在内：Safari 能渲染，Chrome/Firefox 不能（详情页仍有图片查看器兜底，
 * 那里加载失败会退回下载面板；列表里没有兜底位置，干脆用后缀徽章）。
 */
const RENDERABLE_IMAGE_MIMES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/bmp",
	"image/svg+xml",
]);

export function isRenderableImage(mime: string): boolean {
	return RENDERABLE_IMAGE_MIMES.has(mime);
}

/**
 * 能否在列表里用 `<img src>` 直接当缩略图。
 * 私密文件为 false：列表的 `<img>` 不带凭据，请求会 401（进详情页才取）。
 * 缺失文件为 false：内容都不在磁盘上，加载必然失败。
 */
export function canThumb(item: FileItem): boolean {
	return !item.missing && !item.is_private && isRenderableImage(item.mime_type);
}

/**
 * 能否进灯箱放大。与 canThumb 的差别是**允许私密**：
 * 灯箱里会先用带凭据的 fetch 换成 blob URL（见 ImageLightbox）。
 */
export function canZoom(item: FileItem): boolean {
	return !item.missing && isRenderableImage(item.mime_type);
}
