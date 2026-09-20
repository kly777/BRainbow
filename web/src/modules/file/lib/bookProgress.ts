// ── 电子书的阅读位置与字号（纯函数 + 常量） ──
//
// 一本书几十上百章，翻到第 40 章、下次打开回到第 1 章是最让人放弃阅读体验的一件事。
// 位置存 localStorage（本地阅读位，一次一台设备，够用；不占后端、不需要同步冲突处理）。
//
// 只存两样：**章号**与**章内滚动比例**。存像素没有意义 —— 换了字号或窗口大小，
// 同一个像素落在完全不同的位置，比例才跟着内容走。

export interface BookProgress {
	/** 章索引（从 0 起） */
	chapter: number;
	/** 章内滚动比例 0..1 */
	ratio: number;
}

/** 按文件存：同一本书的不同版本/不同文件互不干扰 */
export const bookProgressKey = (storedId: string) => `file:book:${storedId}`;

/**
 * 解析存档。任何一处不合法就当作"没有存档"——**宁可从头开始，也不要跳到半路**：
 * 章节数变了（书被替换/重新上传）时，旧的章号可能是越界的。
 */
export function parseBookProgress(
	raw: string | null,
): BookProgress | undefined {
	if (!raw) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const { chapter, ratio } = parsed as { chapter?: unknown; ratio?: unknown };
	if (
		typeof chapter !== "number" ||
		!Number.isInteger(chapter) ||
		chapter < 0
	) {
		return undefined;
	}
	if (typeof ratio !== "number" || !Number.isFinite(ratio)) return undefined;
	return { chapter, ratio: Math.min(1, Math.max(0, ratio)) };
}

export function serializeBookProgress(progress: BookProgress): string {
	return JSON.stringify({
		chapter: progress.chapter,
		ratio: Math.min(1, Math.max(0, progress.ratio)),
	});
}

/** 章内滚动比例；容器还没布局（高度为 0）时返回 0，避免 NaN 写进存档 */
export function scrollRatioOf(el: {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
}): number {
	const scrollable = el.scrollHeight - el.clientHeight;
	if (scrollable <= 0) return 0;
	return Math.min(1, Math.max(0, el.scrollTop / scrollable));
}

/** 正文字号档位（全局偏好，不随书变） */
export const FONT_SCALES = [0.9, 1, 1.15, 1.3] as const;
export const DEFAULT_FONT_SCALE_INDEX = 1;
export const fontScaleKey = "file:book:font-scale";

export function clampFontScaleIndex(value: number): number {
	if (!Number.isInteger(value)) return DEFAULT_FONT_SCALE_INDEX;
	return Math.min(FONT_SCALES.length - 1, Math.max(0, value));
}

export function parseFontScaleIndex(raw: string | null): number {
	if (raw === null) return DEFAULT_FONT_SCALE_INDEX;
	return clampFontScaleIndex(Number.parseInt(raw, 10));
}
