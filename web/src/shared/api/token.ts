// ── 认证凭证的 localStorage 存取（纯函数，无框架依赖） ──
// 供 lib/api/request.ts（请求层）与 modules/auth（登录状态）共用，
// 避免请求层反向依赖业务层。读操作做内存缓存，避免每次请求重复 JSON.parse。

import { trySync, unwrapOr } from "@shared/utils/result.ts";

export const STORAGE_KEY = "brainbow_user";
export const API_KEY_STORAGE_KEY = "brainbow_api_key";

export interface StoredUser {
	id: number;
	name: string;
	role: string;
	token?: string;
}

/** undefined = 尚未读取；null = 已读取但无有效用户 */
let userCache: StoredUser | null | undefined;
let apiKeyCache: string | null | undefined;

function loadFromStorage(): StoredUser | null {
	if (userCache !== undefined) return userCache;
	const result = trySync(() => {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		try {
			const parsed = JSON.parse(raw);
			if (
				parsed &&
				typeof parsed === "object" &&
				typeof parsed.id === "number" &&
				typeof parsed.name === "string"
			) {
				return parsed as StoredUser;
			}
		} catch {
			// JSON 解析失败，返回 null
		}
		return null;
	});
	userCache = unwrapOr(result, null);
	return userCache;
}

/** 当前登录 token（localStorage 直读 + 内存缓存，非响应式） */
export function getToken(): string | null {
	return loadFromStorage()?.token ?? null;
}

/** 当前 API key（localStorage 直读 + 内存缓存，非响应式） */
export function getApiKey(): string | null {
	if (apiKeyCache !== undefined) return apiKeyCache;
	const result = trySync(() => localStorage.getItem(API_KEY_STORAGE_KEY));
	apiKeyCache = unwrapOr(result, null);
	return apiKeyCache;
}

/** 持久化登录用户 */
export function saveUser(user: StoredUser): void {
	userCache = user;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

/** 清除登录用户 */
export function clearUser(): void {
	userCache = null;
	localStorage.removeItem(STORAGE_KEY);
}

/** 持久化 / 清除 API key */
export function setApiKey(key: string | null): void {
	apiKeyCache = key;
	if (key) {
		localStorage.setItem(API_KEY_STORAGE_KEY, key);
	} else {
		localStorage.removeItem(API_KEY_STORAGE_KEY);
	}
}
