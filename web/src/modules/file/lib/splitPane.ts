// ── 详情页左右两栏的宽度：拖拽调整 + 记住比例（纯函数 + localStorage 键） ──
//
// 看文档/大图时想给预览更大空间，此前只能缩放整个浏览器窗口 —— 而侧栏那些元信息
// 在那一刻并不重要。拖一条分隔条就够了。
//
// 存的是**侧栏宽度**（px）而不是比例：比例在窗口变化时会让侧栏跟着缩，而侧栏里是
// 键值对文本、字号固定，"多宽能读"是个绝对量。窗口变窄时只做下限/上限夹取。

/** 侧栏宽度上下限（px）：低于 12rem 键值对折行得没法读，高于这个值预览就没地方了 */
export const SIDE_MIN_PX = 200;
export const SIDE_MAX_PX = 560;
export const SIDE_DEFAULT_PX = 288; // 与旧样式里的 18rem 一致

export const sideWidthKey = "file:detail:side-width";

/** 夹到允许区间；非数字/NaN 一律回默认值 */
export function clampSideWidth(value: number): number {
	if (!Number.isFinite(value)) return SIDE_DEFAULT_PX;
	return Math.min(SIDE_MAX_PX, Math.max(SIDE_MIN_PX, Math.round(value)));
}

export function parseSideWidth(raw: string | null): number {
	if (raw === null) return SIDE_DEFAULT_PX;
	return clampSideWidth(Number.parseFloat(raw));
}

/**
 * 拖拽后的新宽度：`startWidth + (当前指针 x − 起点 x)`。
 *
 * 分隔条在右侧栏的**左边缘**，所以指针往右拖 = 侧栏变窄（`direction = -1`）；
 * 参数化一下比在两处写反号安全。
 */
export function draggedSideWidth(
	startWidth: number,
	startX: number,
	currentX: number,
	/** 指针向右移动时侧栏宽度的变化方向：分隔条在其左边缘时为 -1 */
	direction: -1 | 1 = -1,
): number {
	return clampSideWidth(startWidth + (currentX - startX) * direction);
}
