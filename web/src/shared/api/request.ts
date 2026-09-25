import { showToast } from "@shared/utils/toastStore.ts";
import { withTimeout } from "./query.ts";
import { getApiKey, getToken } from "./token.ts";
import { HttpError, NetworkError } from "./types/index.ts";

export const API_BASE_URL = "/api";

// ==================== 全局副作用（与业务无关，组件不感知） ====================

/** 登录弹窗事件 —— AuthDialog 监听它自动弹出登录框 */
export const AUTH_REQUIRED_EVENT = "auth:required";

let _authFiredAt = 0;

/**
 * 触发登录弹窗 + 一条集中 toast（3 秒去重防并发）。
 * 组件层的 notifyError 对 401 静默，避免一人犯错全楼挨骂。
 */
function triggerAuthRequired(): void {
	const now = Date.now();
	if (now - _authFiredAt < 3000) return;
	_authFiredAt = now;
	globalThis.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
	toast({
		type: "warning",
		title: "请先登录",
		message: "登录已过期或尚未登录",
		duration: 4000,
	});
}

function toast(opts: {
	type: "error" | "warning";
	title: string;
	message: string;
	details?: string;
	duration?: number;
}): void {
	// duration 提供默认值以匹配 showToast 的 non-optional 签名
	showToast({ ...opts, duration: opts.duration ?? 5000 });
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

	// Cloudflare 等中间件返回 HTML 而非 JSON，不显示原始 HTML
	const trimmed = text.trimStart();
	if (trimmed.startsWith("<")) {
		const reason =
			response.status === 403
				? "请求被防火墙拦截"
				: response.status >= 500
					? "服务器暂时不可用，请稍后重试"
					: `服务器返回异常 (${response.status})`;
		return { code: `HTTP_${response.status}`, message: reason };
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

	// ── 401 → 静默触发登录弹窗（AuthDialog 对话框是唯一的 UI）──
	if (status === 401) {
		triggerAuthRequired();
		return;
	}

	// ── 403 → toast 提示 ──
	if (status === 403) {
		toast({
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
		toast({
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

/** 非流式请求默认超时：普通查询给足余量；大上传/AI 长任务显式关闭 */
const DEFAULT_TIMEOUT_MS = 15_000;

export interface RequestOptions extends RequestInit {
	/** 覆盖默认超时毫秒；传 false 关闭超时（大文件上传、AI 长任务） */
	timeout?: number | false;
}

export const request = async <T>(
	endpoint: string,
	options: RequestOptions = {},
): Promise<T> => {
	const url = `${API_BASE_URL}${endpoint}`;

	const {
		timeout = DEFAULT_TIMEOUT_MS,
		signal: externalSignal,
		...fetchOptions
	} = options;
	let signal: AbortSignal | undefined = externalSignal ?? undefined;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let timedOut = false;
	if (timeout !== false) {
		const merged = withTimeout(timeout, signal ?? null, () => {
			timedOut = true;
		});
		signal = merged.signal;
		timer = merged.timer;
	}

	let response: Response;
	try {
		response = await fetch(url, {
			...fetchOptions,
			signal,
			headers: buildHeaders(fetchOptions.headers, fetchOptions.body),
		});
	} catch (cause: unknown) {
		if ((cause as Error)?.name === "AbortError") {
			// ── 主动取消：静默抛出，不弹网络错误 toast ──
			if (!timedOut) {
				throw new NetworkError({ cause, canceled: true });
			}
			// ── 默认超时：明确提示，而不是伪装成"网络断开" ──
			await toast({
				type: "error",
				title: "请求超时",
				message: "服务器响应超时，请稍后重试",
				details: "TIMEOUT",
				duration: 6000,
			});
			throw new NetworkError({ cause, message: "请求超时，请稍后重试" });
		}
		// ── 网络断开 → 全局 toast + 日志，然后抛出 ──
		console.error(`[API] NETWORK ${endpoint}:`, cause);
		// 未登录时大请求体（如书签导入）可能被服务器/代理截断连接，
		// 收不到 401 而是 NetworkError —— 兜底弹登录提示
		if (!getToken()) {
			await triggerAuthRequired();
		} else {
			toast({
				type: "error",
				title: "网络连接失败",
				message: "请检查网络后重试",
				details: "NETWORK",
				duration: 6000,
			});
		}
		throw new NetworkError({ cause });
	} finally {
		if (timer !== null) clearTimeout(timer);
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
		// 空响应体（如后端 200 无内容）→ undefined，不误报网络错误
		const text = await response.text();
		if (!text) return undefined as unknown as T;
		json = JSON.parse(text);
	} catch (cause: unknown) {
		throw new NetworkError({ cause });
	}

	return json as T;
};

// ==================== 辅助 ====================
// ==================== HTTP 方法快捷方式 ====================

/** GET */
export const get = <T>(endpoint: string, options?: RequestInit): Promise<T> =>
	request<T>(endpoint, { method: "GET", ...options });

/** POST JSON body */
export const post = <T>(endpoint: string, body: unknown): Promise<T> =>
	request<T>(endpoint, {
		method: "POST",
		body: JSON.stringify(body),
	});

/** PUT JSON body */
export const put = <T>(endpoint: string, body: unknown): Promise<T> =>
	request<T>(endpoint, {
		method: "PUT",
		body: JSON.stringify(body),
	});

/** PATCH JSON body */
export const patch = <T>(endpoint: string, body: unknown): Promise<T> =>
	request<T>(endpoint, {
		method: "PATCH",
		body: JSON.stringify(body),
	});

/** DELETE */
export const del = <T>(endpoint: string): Promise<T> =>
	request<T>(endpoint, { method: "DELETE" });

/**
 * 文件/二进制下载：与 request() 同一套认证头与非 2xx 全局错误处理，
 * 成功返回原始 Response（调用方自取 blob / 响应头）。
 * 导出以供 CSV 导出等无法走 JSON request() 的场景复用。
 */
export const requestFile = async (endpoint: string): Promise<Response> => {
	const url = `${API_BASE_URL}${endpoint}`;
	let response: Response;
	try {
		response = await fetch(url, { headers: buildHeaders() });
	} catch (cause: unknown) {
		console.error(`[API] NETWORK ${endpoint}:`, cause);
		throw new NetworkError({ cause });
	}

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

		await handleGlobalError(endpoint, httpError);

		throw httpError;
	}

	return response;
};

export function buildHeaders(
	extra?: RequestInit["headers"],
	body?: BodyInit | null,
): Headers {
	const headers = new Headers();

	// FormData 让浏览器自动设 Content-Type（含 boundary），手动设会破坏上传；
	// GET 等无 body 请求不设 Content-Type
	if (body && !(body instanceof FormData)) {
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
	} else {
		const apiKey = getApiKey();
		if (apiKey) {
			headers.set("X-API-Key", apiKey);
		}
	}

	return headers;
}
