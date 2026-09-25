// ── 错误模型：错误类 + 错误 → 文案的唯一映射 ──
//
// 这里是错误处理的"模型层"（见 doc/error-handling.md）：三个错误类由传输层抛出，
// `getErrorMessage` 是错误文案的唯一来源（Toast、错误态槽位、日志都走它）。
// 本文件**不依赖任何 UI**（不含 toastStore / 组件），因此谁都能引。

// ── Error 类 ──

export class NetworkError extends Error {
	readonly cause: unknown;
	/** 主动取消（AbortError）：调用方应静默处理，不弹错误提示 */
	readonly canceled: boolean;

	constructor(args: {
		readonly cause: unknown;
		readonly canceled?: boolean;
		readonly message?: string;
	}) {
		super(args.message ?? "Network error");
		this.name = "NetworkError";
		this.cause = args.cause;
		this.canceled = args.canceled ?? false;
	}

	static fromUnknown(cause: unknown): NetworkError {
		return new NetworkError({ cause });
	}
}

export class HttpError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details?: unknown;

	constructor(args: {
		readonly status: number;
		readonly code: string;
		readonly message: string;
		readonly details?: unknown;
	}) {
		super(args.message);
		this.name = "HttpError";
		this.status = args.status;
		this.code = args.code;
		this.details = args.details;
	}
}

export class ValidationError extends Error {
	readonly error: unknown;

	constructor(args: { readonly error: unknown }) {
		super("Validation error");
		this.name = "ValidationError";
		this.error = args.error;
	}
}

export type ApiErrorType = NetworkError | HttpError | ValidationError;

// ── 错误消息提取 ──

/** 从任意错误对象提取用户友好的中文消息 */
export function getErrorMessage(error: unknown): string {
	if (error instanceof HttpError) {
		const details = error.details ? ` (${JSON.stringify(error.details)})` : "";
		return error.message
			? `${error.message}${details}`
			: `服务器错误 (${error.status}, ${error.code})`;
	}
	if (error instanceof NetworkError) {
		return error.message === "Network error"
			? "网络连接失败，请检查网络"
			: error.message;
	}
	if (error instanceof ValidationError) {
		return "数据格式错误，请联系开发者";
	}
	if (error instanceof Error) {
		return error.message;
	}
	return "未知错误";
}
