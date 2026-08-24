// ── API Key 管理 API ──

import { del, get, post } from "@lib/api";

export interface ApiKeyInfo {
	id: number;
	role: string;
	created_at: string;
	key?: string;
}

/** 当前用户可见的 key 列表 */
export const listKeysE = (): Promise<ApiKeyInfo[]> => get("/auth/keys");

/** 生成新 key（明文仅本次响应返回一次） */
export const createKeyE = (): Promise<ApiKeyInfo> => post("/auth/key", {});

/** 删除指定 key */
export const deleteKeyE = (id: number): Promise<unknown> =>
	del(`/auth/key/${id}`);
