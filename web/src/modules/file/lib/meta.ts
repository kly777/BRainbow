// ── 文件元信息的展示格式化（卡片 / 列表行 / 详情共用） ──

/** 毫秒 → "3:21" / "1:02:03" */
export function fmtDuration(ms: number): string {
	const total = Math.round(ms / 1000);
	const seconds = String(total % 60).padStart(2, "0");
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	if (hours > 0)
		return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
	return `${minutes}:${seconds}`;
}

/** 时长（毫秒，后端可能为空）→ "2:05"；无有效时长返回 null */
export function fmtDurationMs(ms: number | null | undefined): string | null {
	return ms && ms > 0 ? fmtDuration(ms) : null;
}

/** 像素尺寸 → "1920 × 1080"；非图片/视频或缺失时返回 null */
export function fmtDimensions(
	width: number | null | undefined,
	height: number | null | undefined,
): string | null {
	return width && height ? `${width} × ${height}` : null;
}
