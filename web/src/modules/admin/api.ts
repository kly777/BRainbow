// ── 管理员设置 API ──

import { request } from "@shared/api";

export interface AdminSettings {
	allow_register: boolean;
	jwt_secret_set: boolean;
	jwt_secret_len: number;
}

export interface ModuleStats {
	users: number;
	tasks: number;
	cards: number;
	memories: number;
	bookmarks: number;
	articles: number;
	conversations: number;
	chat_trees: number;
	ontologies: number;
}

export interface SystemInfo {
	version: string;
	uptime_secs: number;
	db_version: number;
	db_page_count: number;
	db_page_size: number;
	db_size_bytes: number;
	stats: ModuleStats;
	server: ServerInfo;
}

/** 目录占用（文件数 + 字节数 + 最近修改时间） */
export interface DirUsage {
	files: number;
	bytes: number;
	newest_modified: string | null;
}

/** 内存用量 */
export interface MemoryInfo {
	total_bytes: number;
	available_bytes: number;
	used_bytes: number;
}

/** 平均负载（1 / 5 / 15 分钟） */
export interface LoadAverage {
	one: number;
	five: number;
	fifteen: number;
}

/** 文件系统用量 */
export interface DiskUsage {
	total_bytes: number;
	free_bytes: number;
	used_bytes: number;
}

/**
 * 服务器侧信息。
 *
 * 每一项都可能为 null（非 Linux 没有 /proc、没配 BACKUP_DIR 就没有备份目录），
 * 页面遇到 null 显示"—"—— 不要把"读不到"显示成 0。
 */
export interface ServerInfo {
	cpu_count: number;
	load: LoadAverage | null;
	memory: MemoryInfo | null;
	disk: DiskUsage | null;
	/** 上传根整体占用（含缩略图与 favicon 缓存） */
	uploads: DirUsage | null;
	/** 其中：缩略图缓存（可再生） */
	thumbs: DirUsage | null;
	/** 其中：favicon 缓存（可再生） */
	favicons: DirUsage | null;
	/** 备份目录占用（份数 = 文件数） */
	backups: DirUsage | null;
	backup_dir: string | null;
}

export const getAdminSettingsE = (): Promise<AdminSettings> =>
	request("/admin/settings", {});

export const updateAdminSettingsE = (
	allowRegister: boolean,
): Promise<AdminSettings> =>
	request("/admin/settings", {
		method: "PATCH",
		body: JSON.stringify({ allow_register: allowRegister }),
	});

export const rotateJwtE = (): Promise<{ ok: boolean; message: string }> =>
	request("/admin/settings/jwt/rotate", { method: "POST" });

export const getSystemInfoE = (): Promise<SystemInfo> =>
	request("/admin/system-info", {});
