// ── 通用工具：URL 参数解析 / 文件下载 ──

/** URL 数字参数解析：非数字返回 null（useSearchParams 原始值场景共用） */
export function parseUrlId(raw: unknown): number | null {
	if (!raw || !/^\d+$/.test(String(raw))) return null;
	return parseInt(String(raw), 10);
}

/** 触发浏览器下载一个 Blob（自动释放 object URL） */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

/** 以文本内容触发下载（UTF-8 + BOM，Excel 打开中文不乱码） */
export function downloadText(
	text: string,
	filename: string,
	mime = "text/plain",
): void {
	downloadBlob(
		new Blob([`\uFEFF${text}`], { type: `${mime};charset=utf-8` }),
		filename,
	);
}
