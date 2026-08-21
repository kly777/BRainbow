// ── SSE 流式请求抽象层 ──
// 复用全局认证（buildHeaders）和错误处理（handleGlobalError），
// 让 SSE 请求不再绕过 request.ts 的统一机制。

import {
	API_BASE_URL,
	buildHeaders,
	extractErrorBody,
	handleGlobalError,
} from "./request.ts";
import { HttpError } from "./types/index.ts";

export interface StreamRequestOptions {
	endpoint: string;
	body?: unknown;
	signal?: AbortSignal;
	onChunk: (chunk: string) => void;
}

/**
 * 发起 SSE 流式请求，逐 chunk 回调。
 * 非 ok 响应走全局错误处理（401 → 登录弹窗，5xx → toast）。
 */
export async function streamRequest(opts: StreamRequestOptions): Promise<void> {
	const url = `${API_BASE_URL}${opts.endpoint}`;
	const headers = buildHeaders();

	const resp = await fetch(url, {
		method: "POST",
		headers,
		body: opts.body ? JSON.stringify(opts.body) : undefined,
		signal: opts.signal,
	});

	if (!resp.ok) {
		const errorBody = await extractErrorBody(resp);
		const httpError = new HttpError({
			status: resp.status,
			code: errorBody.code,
			message: errorBody.message,
			details: errorBody.details,
		});
		await handleGlobalError(opts.endpoint, httpError);
		throw httpError;
	}

	if (!resp.body) {
		throw new Error("浏览器不支持流式响应");
	}

	// 读取 SSE 流：逐行解析 data: 前缀
	const reader = resp.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("data:")) continue;
			// 只按 SSE 规范去掉冒号后的一个空格，保留 token 内容自身的首尾空白
			const data = trimmed.startsWith("data: ")
				? trimmed.slice(6)
				: trimmed.slice(5);
			opts.onChunk(data);
		}
	}
}
