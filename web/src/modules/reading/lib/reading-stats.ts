// ── 阅读认识度的口径（单一来源） ──
//
// 阈值与百分比此前写在 ReadingList 的卡片里，同一段三元各写两遍（外层的
// data-known 与内层 `.ratio` 的），改一处漏一处两处就会不一致；百分比也在
// 文案与进度条宽度里各算一次。列表页与详情页的口径统一走这里。

/** 认识度分档：CSS 用 `[data-known="high|mid|low"]` 上色 */
export type KnownLevel = "high" | "mid" | "low";

/** ≥80% 基本可读（"推荐先读"也按这档挑），50%–80% 中等，其余偏低 */
export function knownLevel(ratio: number): KnownLevel {
	if (ratio >= 0.8) return "high";
	if (ratio >= 0.5) return "mid";
	return "low";
}

/** 认识度百分比文本：文案与进度条宽度共用同一个值（沿用 toFixed(0) 的取整） */
export function knownPercent(ratio: number): string {
	return (ratio * 100).toFixed(0);
}
