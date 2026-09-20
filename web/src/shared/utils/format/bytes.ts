/**
 * 格式化字节大小为人类可读字符串（B / KB / MB / GB）。
 *
 * 两种口径各有其用：
 * - 默认（不传 options）：KB/MB 一位小数、GB 两位 —— 用于"文件多大"。
 * - `compact: true`：整数不带小数（"200 MB" 而不是 "200.0 MB"）—— 用于"上限
 *   200 MB"这类**以数量级传达信息**的文案，多出来的小数位只是噪音。
 *
 * 两种口径都只此一处实现：file/lib/uploadLimits.ts 曾另有一份同名的局部
 * formatBytes（口径与 compact 相同），同名不同义最容易让人 import 错。
 */
export function formatBytes(
	bytes: number,
	options?: { compact?: boolean },
): string {
	const compact = options?.compact === true;
	/** compact 口径：整数报整数，否则一位小数 */
	const compactValue = (value: number) =>
		Number.isInteger(value) ? String(value) : value.toFixed(1);

	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) {
		const kb = bytes / 1024;
		return `${compact ? compactValue(kb) : kb.toFixed(1)} KB`;
	}
	if (bytes < 1024 * 1024 * 1024) {
		const mb = bytes / (1024 * 1024);
		return `${compact ? compactValue(mb) : mb.toFixed(1)} MB`;
	}
	const gb = bytes / (1024 * 1024 * 1024);
	return `${compact ? compactValue(gb) : gb.toFixed(2)} GB`;
}
