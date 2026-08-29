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
