// ── 灯箱缩放的数学（纯函数） ──
//
// 缩放本身只是改一个倍数，真正需要算的是**"以指针为中心"的滚动补偿**：放大后要让指针
// 底下的那块内容留在原地（否则滚轮一滚，图就跑到视野外了）。这是编辑器和地图的通用做法。
//
// 比例用**乘法步进**（每次 ×1.25）而不是加法：加法在高倍率下几乎看不出变化
// （400% → 410%），乘法在任何档位的手感都一样。

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;
/** 一档的倍数（滚轮 / 按钮共用） */
export const SCALE_STEP = 1.25;
/** 按钮与滚轮都按这个档位走，避免出现 137% 这种零碎值 */
export const SCALE_BUTTON_STEP = 1.5;

export function clampScale(value: number): number {
	if (!Number.isFinite(value)) return MIN_SCALE;
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

/** 放大/缩小一档；已在两端时保持不变（按钮据此置灰） */
export function stepScale(current: number, direction: 1 | -1): number {
	return clampScale(
		direction > 0 ? current * SCALE_STEP : current / SCALE_STEP,
	);
}

export function canZoomIn(current: number): boolean {
	return current < MAX_SCALE;
}

export function canZoomOut(current: number): boolean {
	return current > MIN_SCALE;
}

/**
 * 缩放后应有的滚动位置，使**指针下的内容留在指针处**。
 *
 * - `pointer`：指针相对容器可视区左上角的偏移（px）
 * - `scroll`：当前滚动位置（px）
 * - `ratio`：新倍数 / 旧倍数
 *
 * 推导：内容坐标 = 指针偏移 + 滚动位置；缩放后该内容坐标变成 `× ratio`，
 * 要让它仍落在同一个指针偏移处，滚动位置 = 内容坐标 × ratio − 指针偏移。
 */
export function zoomedScroll(
	pointer: number,
	scroll: number,
	ratio: number,
): number {
	return (pointer + scroll) * ratio - pointer;
}

/**
 * "100% = 原始像素"的显示比例。
 *
 * 直接显示缩放倍数（250%）会让人以为是原图的 2.5 倍，其实大图在"适应窗口"时可能只有
 * 原图的 12%。按原始像素算，双击切到 1:1 时正好读到 100% —— 与图片编辑器的口径一致。
 */
export function pixelPercent(
	renderedWidth: number,
	naturalWidth: number,
): number {
	if (
		!Number.isFinite(renderedWidth) ||
		!Number.isFinite(naturalWidth) ||
		naturalWidth <= 0
	) {
		return 0;
	}
	return Math.round((renderedWidth / naturalWidth) * 100);
}

/** 双击切换：已放大 → 回到适应；否则 → 原始像素（1:1）。返回 null 表示这张图没有 1:1 档 */
export function toggledScale(current: number, oneToOne: number): number {
	if (current > MIN_SCALE) return MIN_SCALE;
	return clampScale(oneToOne);
}
