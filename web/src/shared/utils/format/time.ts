/** 统一时间处理 */

import { trySync, unwrapOr } from "../result.ts";

/** 当前时间按后端存储格式输出（YYYY-MM-DDTHH:MM:SS+00:00，UTC） */
export function nowIsoUtc(): string {
	return `${new Date().toISOString().slice(0, 19)}+00:00`;
}

/** 解析可能有缺 Z 的 UTC 时间字符串 */
export function parseUtc(ts: string): Date {
	if (!ts.endsWith("Z") && !ts.includes("+") && !ts.includes("-", 10)) {
		return new Date(`${ts}Z`);
	}
	return new Date(ts);
}

/** 格式化为本地时间 "06/10 22:00" */
export function fmtLocal(ts: string): string {
	return parseUtc(ts).toLocaleString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** 格式化为完整本地时间 "2026/06/10 22:00"（带年份） */
export function fmtFull(ts: string): string {
	const result = trySync(() => {
		const d = parseUtc(ts);
		if (Number.isNaN(d.getTime())) return ts;
		return d.toLocaleString("zh-CN", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	});
	return unwrapOr(result, ts);
}

/** 格式化为相对时间 "3天后" / "待复习" */
export function fmtRelative(ts: string): string {
	const d = parseUtc(ts);
	const diff = (d.getTime() - Date.now()) / 1000;
	if (diff < 0) return `待复习`;
	if (diff < 120) return "1分钟";
	if (diff < 3600) return `${Math.round(diff / 60)}分钟`;
	if (diff < 86400) return `${Math.round(diff / 3600)}小时`;
	return `${Math.round(diff / 86400)}天后`;
}

/** 秒数 → 人类可读 "3天" / "1分钟" */
export function fmtInterval(secs: number): string {
	if (secs < 120) return "1分钟";
	if (secs < 3600) return `${Math.round(secs / 60)}分钟`;
	if (secs < 86400) return `${Math.round(secs / 3600)}小时`;
	if (secs < 2592000) return `${Math.round(secs / 86400)}天`;
	return `${Math.round(secs / 2592000)}个月`;
}
