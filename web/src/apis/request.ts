import { Effect, Schema } from "effect";
import { getUserId } from "../auth";
import {
	type ApiErrorType,
	HttpError,
	NetworkError,
	ValidationError,
} from "./types";

// ==================== API Configuration ====================

const API_BASE_URL = "/api";

// ==================== Request Helper ====================

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
						const userId = getUserId();
						if (userId) {
							headers.set("X-User-Id", String(userId));
						}
						return headers;
					})(),
				}),
			catch: (cause: unknown) => new NetworkError({ cause }),
		});

		if (!response.ok) {
			let errorMessage = `HTTP ${response.status}`;
			try {
				const errorData = yield* Effect.tryPromise({
					try: async (): Promise<{ error: string }> => response.json(),
					catch: (cause: unknown) => new NetworkError({ cause }),
				});
				errorMessage = errorData.error || errorMessage;
			} catch {
				// If we can't parse JSON error, use default message
			}

			return yield* Effect.fail(
				new HttpError({ status: response.status, message: errorMessage }),
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
