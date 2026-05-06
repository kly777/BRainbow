import { Effect, Schema } from "effect";
import { getToken } from "../auth";
import {
	type ApiErrorType,
	type ApiErrorResponse,
	HttpError,
	NetworkError,
	ValidationError,
} from "./types";

const API_BASE_URL = "/api";

/**
 * 尝试从响应体解析后端统一错误格式 { code, message, details }。
 * 兼容旧格式 { error: "..." } 和纯文本。
 */
async function extractErrorBody(
	response: Response,
): Promise<ApiErrorResponse> {
	try {
		const text = await response.text();
		if (!text) {
			return {
				code: `HTTP_${response.status}`,
				message: `HTTP ${response.status}`,
			};
		}
		const json = JSON.parse(text);
		// 新统一格式: { code, message, details? }
		if (json && typeof json.code === "string" && typeof json.message === "string") {
			return {
				code: json.code,
				message: json.message,
				details: json.details,
			};
		}
		// 旧格式: { error: "..." }
		if (json && typeof json.error === "string") {
			return {
				code: `HTTP_${response.status}`,
				message: json.error,
			};
		}
		// 兜底：整个文本作为消息
		return {
			code: `HTTP_${response.status}`,
			message: text.length > 200 ? text.slice(0, 200) : text,
		};
	} catch {
		return {
			code: `HTTP_${response.status}`,
			message: `HTTP ${response.status}`,
		};
	}
}

/**
 * 通用的API请求函数
 * @param endpoint API端点
 * @param schema 响应数据的Schema
 * @param options 请求选项
 * @returns Effect包装的API响应
 */
export const request = <T>(
	endpoint: string,
	schema: Schema.Schema<T>,
	options: RequestInit = {},
): Effect.Effect<T, ApiErrorType> =>
	Effect.gen(function* () {
		const url = `${API_BASE_URL}${endpoint}`;

		const response = yield* Effect.tryPromise({
			try: async () =>
				fetch(url, {
					...options,
					headers: (() => {
						const headers = new Headers({
							"Content-Type": "application/json",
						});
						if (options.headers) {
							if (Array.isArray(options.headers)) {
								for (const [key, value] of options.headers) {
									if (value !== undefined) {
										headers.append(key, String(value));
									}
								}
							} else if (typeof options.headers === "object") {
								for (const [key, value] of Object.entries(options.headers)) {
									if (value !== undefined) {
										headers.append(key, String(value));
									}
								}
							}
						}
						const token = getToken();
						if (token) {
							headers.set("Authorization", `Bearer ${token}`);
						}
						return headers;
					})(),
				}),
			catch: (cause: unknown) => new NetworkError({ cause }),
		});

		if (!response.ok) {
			const errorBody = yield* Effect.tryPromise({
				try: () => extractErrorBody(response),
				catch: (cause: unknown) => new NetworkError({ cause }),
			});

			return yield* Effect.fail(
				new HttpError({
					status: response.status,
					code: errorBody.code,
					message: errorBody.message,
					details: errorBody.details,
				}),
			);
		}

		if (response.status === 204) {
			return undefined as unknown as T;
		}

		const json = yield* Effect.tryPromise({
			try: async () => response.json() as unknown,
			catch: (cause: unknown) => new NetworkError({ cause }),
		});

		const result = yield* Schema.decodeUnknown(schema)(json).pipe(
			Effect.mapError(
				(issue: unknown) => new ValidationError({ error: issue }),
			),
		);

		return result;
	});
