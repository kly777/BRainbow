// ── 管理员设置 API ──

import { request } from "@lib/api";

export interface AdminSettings {
	allow_register: boolean;
	jwt_secret_set: boolean;
	jwt_secret_len: number;
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
