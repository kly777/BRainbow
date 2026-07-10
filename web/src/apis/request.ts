import { getToken } from "../auth/context.tsx";
import {
	buildCacheKey,
	CACHE,
	clearAllCache as cacheClear,
	invalidateCache as cacheInvalidate,
	readCache,
	writeCache,
} from "./cache.ts";
import { HttpError, NetworkError } from "./types/index.ts";

export { CACHE };

const API_BASE_URL = "/api";

// ==================== 全局副作用（与业务无关，组件不感知） ====================

/** 登录弹窗事件 —— AuthStatus 监听它自动弹出登录框 */
export const AUTH_REQUIRED_EVENT = "auth:required";

let _authFiredAt = 0;

async function triggerAuthRequired(
	message: string,
	code: string,
): Promise<void> {
	const now = Date.now();
	if (now - _authFiredAt < 3000) return; // 3 秒内去重，防止并发 401 重复弹窗
	_authFiredAt = now;
	globalThis.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
	await toast({
		type: "warning",
		title: "请先登录",
		message,
		details: code,
		duration: 4000,
	});
}

/** 延迟导入避免循环依赖 */
let _showToast:
	| ((opts: {
			type: "error" | "warning";
			title: string;
			message: string;
			details?: string;
			duration?: number;
	  }) => void)
	| null = null;

async function toast(opts: {
	type: "error" | "warning";
	title: string;
	message: string;
	details?: string;
	duration?: number;
}): Promise<void> {
	if (!_showToast) {
		const mod = await import("../components/ui/toastStore.ts");
		_showToast = mod.showToast as unknown as typeof _showToast;
	}
	// duration 提供默认值以匹配 showToast 的 non-optional 签名
	_showToast?.({ ...opts, duration: opts.duration ?? 5000 });
}

// ==================== 错误体解析 ====================

export async function extractErrorBody(
	response: Response,
): Promise<{ code: string; message: string; details?: unknown }> {
	const text = await response.text().catch(() => "");

	if (!text) {
		return {
			code: `HTTP_${response.status}`,
			message: `HTTP ${response.status}`,
		};
	}

	try {
		const json = JSON.parse(text);
		if (
			json &&
			typeof json.code === "string" &&
			typeof json.message === "string"
		) {
			return {
				code: json.code,
				message: json.message,
				details: json.details,
			};
		}
		if (json && typeof json.error === "string") {
			return { code: `HTTP_${response.status}`, message: json.error };
		}
	} catch {
		/* 纯文本，直接用 */
	}

	const short = text.length > 200 ? text.slice(0, 200) : text;
	return { code: `HTTP_${response.status}`, message: short };
}

// ==================== 全局错误副作用（所有请求统一触发，不拦截错误） ====================

/**
 * 对错误执行全局副作用（登录弹窗 / toast / 日志），
 * 然后原样将错误向上传播给组件做业务处理。
 *
 * 导出以供 uploadMedia 等无法使用 request() 的场景统一错误处理。
 */
export async function handleGlobalError(
	endpoint: string,
	httpError: HttpError,
): Promise<void> {
	const { status, code, message } = httpError;

	// ── 日志：所有错误统一输出 ──
	console.error(`[API] ${status} ${endpoint} — ${code}: ${message}`);

	// ── 401 → 登录弹窗 + toast ──
	if (status === 401) {
		await triggerAuthRequired(message, code);
		return;
	}

	// ── 403 → toast 提示 ──
	if (status === 403) {
		await toast({
			type: "error",
			title: "权限不足",
			message,
			details: code,
			duration: 5000,
		});
		return;
	}

	// ── 5xx 服务器崩溃 → toast（组件通常只做回滚，不展示消息） ──
	if (status >= 500) {
		await toast({
			type: "error",
			title: "服务器错误",
			message: message || "服务器内部错误，请稍后重试",
			details: code,
			duration: 8000,
		});
		return;
	}

	// ── 4xx 业务错误（404/409/422 等）→ 只打日志，由组件处理 UI ──
}

// ==================== 核心请求函数 ====================

/**
 * 带缓存的 GET 请求。对于非 GET 请求，行为与 request() 相同。
 *
 * @param endpoint - API 路径（不含 /api 前缀）
 * @param options - fetch options
 * @param staleMs - 缓存有效期，默认 30 秒
 */
export const cachedRequest = async <T>(
	endpoint: string,
	options: RequestInit = {},
	staleMs = 30_000,
): Promise<T> => {
	const method = (options.method ?? "GET").toUpperCase();

	// 非 GET 请求不走缓存
	if (method !== "GET") {
		return request<T>(endpoint, options);
	}

	const key = buildCacheKey(method, endpoint);
	const cached = readCache<T>(key, staleMs);
	if (cached !== null) {
		return cached;
	}

	const data = await request<T>(endpoint, options);
	writeCache(key, data);
	return data;
};

/**
 * 使匹配正则表达式的缓存失效。
 * 在增删改操作完成后调用，确保下次读取拿到最新数据。
 *
 * @example
 *   invalidateCache(/^GET \/cards/)
 */
export const invalidateCache = cacheInvalidate;

/**
 * 清除所有缓存。
 */
export const clearAllCache = cacheClear;

/**
 * 在 Promise 链中使缓存失效并透传结果。
 * 用于增删改操作完成后自动失效相关缓存。
 *
 * @example
 *   request("/cards", { method: "POST", body }).then(r => tapInvalidate(CACHE.cards, r))
 */
export function tapInvalidate<T>(pattern: RegExp, result: T): T {
	cacheInvalidate(pattern);
	return result;
}

export const request = async <T>(
	endpoint: string,
	options: RequestInit = {},
): Promise<T> => {
	const url = `${API_BASE_URL}${endpoint}`;

	let response: Response;
	try {
		response = await fetch(url, {
			...options,
			headers: buildHeaders(options.headers, options.body),
		});
	} catch (cause: unknown) {
		// ── 网络断开 → 全局 toast + 日志，然后抛出 ──
		console.error(`[API] NETWORK ${endpoint}:`, cause);
		toast({
			type: "error",
			title: "网络连接失败",
			message: "请检查网络后重试",
			details: "NETWORK",
			duration: 6000,
		});
		throw new NetworkError({ cause });
	}

	// ── 非 2xx → 全局副作用 + 抛出 ──
	if (!response.ok) {
		let errorBody: { code: string; message: string; details?: unknown };
		try {
			errorBody = await extractErrorBody(response);
		} catch (cause: unknown) {
			throw new NetworkError({ cause });
		}

		const httpError = new HttpError({
			status: response.status,
			code: errorBody.code,
			message: errorBody.message,
			details: errorBody.details,
		});

		// 全局副作用：日志 + toast/登录（不拦截错误，继续抛给组件）
		await handleGlobalError(endpoint, httpError);

		throw httpError;
	}

	if (response.status === 204) {
		return undefined as unknown as T;
	}

	let json: unknown;
	try {
		json = await response.json();
	} catch (cause: unknown) {
		throw new NetworkError({ cause });
	}

	return json as T;
};

// ==================== 辅助 ====================

function buildHeaders(
	extra?: RequestInit["headers"],
	body?: BodyInit | null,
): Headers {
	const headers = new Headers();

	// FormData 让浏览器自动设 Content-Type（含 boundary），手动设会破坏上传
	if (!(body instanceof FormData)) {
		headers.set("Content-Type", "application/json");
	}

	// 合并外部 headers：调用方提供的值优先（用 set 而非 append，避免重复）
	if (extra) {
		const entries = Array.isArray(extra) ? extra : Object.entries(extra);
		for (const [key, value] of entries) {
			if (value !== undefined) {
				headers.set(key, String(value));
			}
		}
	}

	const token = getToken();
	if (token) {
		headers.set("Authorization", `Bearer ${token}`);
	}

	return headers;
}
