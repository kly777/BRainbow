// ==================== Error 类 · Schema · 错误工具 ====================

import { Data, Schema } from "effect";
import { showToast } from "../../components/toastStore.ts";

// ── 后端错误响应 Schema ──

export const ApiErrorResponseSchema = Schema.Struct({
	code: Schema.String,
	message: Schema.String,
	details: Schema.optional(Schema.Unknown),
});

export type ApiErrorResponse = Schema.Schema.Type<typeof ApiErrorResponseSchema>;

// ── Error 类 ──

export class NetworkError extends Data.TaggedError("NetworkError")<{
	readonly cause: unknown;
}> {
	static fromUnknown(cause: unknown): NetworkError {
		return new NetworkError({ cause });
	}
}

export class HttpError extends Data.TaggedError("HttpError")<{
	readonly status: number;
	readonly code: string;
	readonly message: string;
	readonly details?: unknown;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
	readonly error: unknown;
}> {}

export type ApiErrorType = NetworkError | HttpError | ValidationError;

// ── 错误消息提取 ──

/** 从任意错误对象提取用户友好的中文消息 */
export function getErrorMessage(error: unknown): string {
	if (error instanceof HttpError) {
		const details = error.details
			? ` (${JSON.stringify(error.details)})`
			: "";
		return error.message
			? `${error.message}${details}`
			: `服务器错误 (${error.status}, ${error.code})`;
	}
	if (error instanceof NetworkError) {
		return "网络连接失败，请检查网络";
	}
	if (error instanceof ValidationError) {
		return "数据格式错误，请联系开发者";
	}
	if (error instanceof Error) {
		return error.message;
	}
	return "未知错误";
}

// ── 内部辅助 ──

function errorToastType(error: unknown): "error" | "warning" {
	if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
		return "warning";
	}
	return "error";
}

function errorCode(error: unknown): string | undefined {
	if (error instanceof HttpError) return error.code;
	if (error instanceof NetworkError) return "NETWORK";
	if (error instanceof ValidationError) return "VALIDATION";
	return undefined;
}

// ── 组件层 toast（仅业务错误，全局错误不重复） ──

export function showErrorAlert(error: unknown, prefix?: string): void {
	if (error instanceof HttpError) {
		if (error.status === 401 || error.status === 403 || error.status >= 500) return;
	}
	if (error instanceof NetworkError || error instanceof ValidationError) return;

	showToast({
		type: errorToastType(error),
		title: prefix || "操作失败",
		message: getErrorMessage(error),
		details: errorCode(error),
		duration: 6000,
	});
}

export function showErrorInline(error: unknown, prefix?: string): string {
	const msg = getErrorMessage(error);
	return prefix ? `${prefix}: ${msg}` : msg;
}
