// ── 管理员页面纯函数（从 AdminPage.tsx 提取以便测试） ──

import type { ModuleStats } from "./api.ts";

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

/** 格式化文件大小 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export type StatKey = keyof ModuleStats;

/** 获取统计值（避免 JSX 中类型断言的语法问题） */
export function getStatValue(stats: ModuleStats, key: StatKey): number {
	return stats[key];
}
