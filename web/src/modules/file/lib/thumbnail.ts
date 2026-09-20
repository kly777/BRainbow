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
 * 能否在列表里用 `<img src>` 当缩略图。
 *
 * 判据以**后端的 `thumb_url` 为准**（能出缩略图的位图与视频都给）：视频的海报帧
 * 也是 `<img>`，而 SVG 这类"能直接渲染但没有服务端缩略图"的仍走原图。
 *
 * 私密文件为 false：列表的 `<img>` 不带凭据，请求会 401（进详情页才取）。
 * 缺失文件为 false：内容都不在磁盘上，加载必然失败。
 */
export function canThumb(item: FileItem): boolean {
	if (item.missing || item.is_private) return false;
	// 后端说能出缩略图 → 走它（视频海报帧也算）；否则退回"浏览器能直接渲染的位图"
	return item.thumb_url ? true : isRenderableImage(item.mime_type);
}

/**
 * 能否进灯箱放大。与 canThumb 的差别是**允许私密**：
 * 灯箱里会先用带凭据的 fetch 换成 blob URL（见 ImageLightbox）。
 */
export function canZoom(item: FileItem): boolean {
	return !item.missing && isRenderableImage(item.mime_type);
}

// ── 服务端缩略图（后端 /thumb 端点） ──

/**
 * 宽度阶梯，**与后端 `src/modules/file/thumb/mod.rs` 的 WIDTH_LADDER 对齐**：
 * 后端会把请求的 w 就近吸附到这几档，所以前端只该从这几档里挑
 * （报别的值等于让后端替我们四舍五入，白写一次 URL）。改一处要同步另一处。
 */
export const THUMB_WIDTHS = [160, 320, 640, 1280] as const;

/** 模糊底衬（LQIP）固定用最小档：它只是"还没看清时的形状"，几 KB 就够 */
export const THUMB_LQIP_WIDTH = 160;

/** 后端给的 thumb_url 形态（用于拼进 CSS url() 前的白名单校验，见 thumbBackdrop） */
const THUMB_URL_RE = /^\/api\/file\/[A-Za-z0-9_-]{12}\/thumb$/;

/** 某个宽度的缩略图地址；该文件没有服务端缩略图时返回 null */
export function thumbSrc(item: FileItem, width: number): string | null {
	if (!item.thumb_url) return null;
	return `${item.thumb_url}?w=${width}`;
}

/** srcset（阶梯全给，由浏览器按 sizes 挑）；没有缩略图时 null */
export function thumbSrcSet(
	item: FileItem,
	widths: readonly number[] = THUMB_WIDTHS,
): string | null {
	if (!item.thumb_url) return null;
	return widths.map((w) => `${item.thumb_url}?w=${w} ${w}w`).join(", ");
}

/**
 * 模糊底衬的 CSS `url(...)`。
 *
 * 会插进 style，所以要过白名单：只接受后端的固定形态（12 位 stored_id）。
 * 不像预期的值一律返回 undefined —— 少一层底衬而已，不值得为它冒险。
 */
export function thumbBackdrop(item: FileItem): string | undefined {
	if (!item.thumb_url || !THUMB_URL_RE.test(item.thumb_url)) return undefined;
	const url = thumbSrc(item, THUMB_LQIP_WIDTH);
	return url ? `url("${url}")` : undefined;
}

/** 比这更瘦（竖图）或更宽（长图）就改用 contain：裁掉的就是主体了 */
const PORTRAIT_MAX = 0.9;
const WIDE_MIN = 2.0;

/**
 * 前景该不该 `contain`（不裁切）。
 *
 * 默认 `cover`（填满、裁边）—— 网格里每张卡片一样大，看着整齐。但手机竖拍
 * （3:4 ≈ 0.75）与长截图（1:5 那种）离 16:10 太远，`cover` 裁掉的正好是主体，
 * 所以这两类改成 `contain`，同时亮出模糊底衬把留白补上（见 thumbBackdrop），
 * 不然就是一块空框。尺寸未知时不动：宁可保持默认。
 *
 * 它同时也是"要不要请求那份额外的小图做底衬"的判据 —— 形状与框差不多时
 * 底衬根本看不见，没必要为装饰多花 24 个请求。
 */
export function preferContain(item: FileItem): boolean {
	const { width, height } = item;
	if (!width || !height) return false;
	const ratio = width / height;
	return ratio < PORTRAIT_MAX || ratio > WIDE_MIN;
}
