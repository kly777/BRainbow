// ── 认证凭证的 localStorage 存取（纯函数，无 React 依赖） ──
// 供 shared/api/request.ts（请求层）与 app/auth/context.tsx（React context）共用，
// 避免请求层反向依赖 app 层。

export const STORAGE_KEY = "brainbow_user";
export const API_KEY_STORAGE_KEY = "brainbow_api_key";

export interface StoredUser {
	id: number;
	name: string;
	role: string;
	token?: string;
}

function loadFromStorage(): StoredUser | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const user = JSON.parse(raw) as StoredUser;
		if (user?.id && user?.name) return user;
	} catch {
		/* ignore parse errors */
	}
	return null;
}

/** 当前登录 token（localStorage 直读，非响应式） */
export function getToken(): string | null {
	return loadFromStorage()?.token ?? null;
}

/** 当前 API key（localStorage 直读，非响应式） */
export function getApiKey(): string | null {
	try {
		return localStorage.getItem(API_KEY_STORAGE_KEY);
	} catch {
		return null;
	}
}

/** 持久化登录用户 */
export function saveUser(user: StoredUser): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

/** 清除登录用户 */
export function clearUser(): void {
	localStorage.removeItem(STORAGE_KEY);
}

/** 持久化 / 清除 API key */
export function setApiKey(key: string | null): void {
	if (key) {
		localStorage.setItem(API_KEY_STORAGE_KEY, key);
	} else {
		localStorage.removeItem(API_KEY_STORAGE_KEY);
	}
}
