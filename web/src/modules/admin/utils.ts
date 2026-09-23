// ── 管理员页面纯函数（从 AdminPage.tsx 提取以便测试） ──

import { formatBytes } from "@shared/utils";
import type { DirUsage, ModuleStats } from "./api.ts";

// 顺手转出：AdminPage 一直从这里取，保持一致（下面几个文案函数也要用它，
// 所以是既 import 又 export，而不是 `export ... from`）
export { formatBytes };

/** 格式化运行时长 */
export function formatUptime(secs: number): string {
	if (secs < 60) return `${secs} 秒`;
	if (secs < 3600) return `${Math.floor(secs / 60)} 分钟`;
	if (secs < 86400) {
		const h = Math.floor(secs / 3600);
		const m = Math.floor((secs % 3600) / 60);
		return `${h} 小时 ${m} 分钟`;
	}
	const d = Math.floor(secs / 86400);
	const h = Math.floor((secs % 86400) / 3600);
	return `${d} 天 ${h} 小时`;
}

export type StatKey = keyof ModuleStats;

/** 获取统计值（避免 JSX 中类型断言的语法问题） */
export function getStatValue(stats: ModuleStats, key: StatKey): number {
	return stats[key];
}

/** 「分子 / 分母」的百分比（0-100，取整）；分母非正时返回 null（不是 0%） */
export function usagePercent(used: number, total: number): number | null {
	if (total <= 0) return null;
	return Math.round((used / total) * 100);
}

/** 用量文案：`3.2G / 7.5G（43%）`；拿不到就"—" */
export function formatUsage(used: number, total: number): string {
	const percent = usagePercent(used, total);
	const size = `${formatBytes(used)} / ${formatBytes(total)}`;
	return percent === null ? size : `${size}（${percent}%）`;
}

/** 目录占用文案：`1.2G（35 个文件）`；null 就是"—" */
export function formatDirUsage(usage: DirUsage | null): string {
	if (!usage) return "—";
	return `${formatBytes(usage.bytes)}（${usage.files} 个文件）`;
}

/** 备份目录文案：`2.8G（20 份）`——备份里一份就是一个文件，所以叫"份" */
export function formatBackupUsage(usage: DirUsage | null): string {
	if (!usage) return "—";
	return `${formatBytes(usage.bytes)}（${usage.files} 份）`;
}

/**
 * ISO-8601 UTC 时间 → 本地可读。
 *
 * 与全站一致：后端存 UTC（不带 Z），展示时补 `Z` 再交给 Date 转本地时区。
 */
export function formatIsoLocal(iso: string | null): string {
	if (!iso) return "—";
	const at = new Date(`${iso}Z`);
	if (Number.isNaN(at.getTime())) return iso;
	return at.toLocaleString();
}
