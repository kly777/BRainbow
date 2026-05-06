import { type Effect, Schema } from "effect";
import { request } from "./request";
import {
	type ApiErrorType,
	type Card,
	CardSchema,
	type CreateCardRequest,
	type Image,
	ImageSchema,
	PaginatedImageSchema,
	PaginatedSchema,
	type PaginatedImage,
	type RenameImageRequest,
	type UpdateCardRequest,
} from "./types";

// ==================== Card API Functions ====================

export const getCards = () =>
	request("/card", PaginatedSchema(CardSchema), {});

export const getCard = (id: number): Effect.Effect<Card, ApiErrorType> =>
	request(`/card/${id}`, CardSchema, {});

export const createCard = (
	card: CreateCardRequest,
): Effect.Effect<Card, ApiErrorType> =>
	request("/card", CardSchema, {
		method: "POST",
		body: JSON.stringify(card),
	});

export const updateCard = (
	id: number,
	card: UpdateCardRequest,
): Effect.Effect<Card, ApiErrorType> =>
	request(`/card/${id}`, CardSchema, {
		method: "PATCH",
		body: JSON.stringify(card),
	});

export const deleteCard = (id: number): Effect.Effect<void, ApiErrorType> =>
	request(`/card/${id}`, Schema.Void, {
		method: "DELETE",
	});

export const searchCards = (
	query: string,
) =>
	request(
		`/card/search?q=${encodeURIComponent(query)}`,
		PaginatedSchema(CardSchema),
		{},
	);

// ==================== Image Upload ====================

import { Effect as E } from "effect";
import { getToken } from "../auth";
import { HttpError, NetworkError, ValidationError } from "./types";

/**
 * 解析后端统一错误响应，兼容多格式
 */
async function extractImageError(response: Response): Promise<{
	code: string;
	message: string;
	details?: unknown;
}> {
	try {
		const json = await response.json();
		// 统一格式: { code, message, details? }
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
		return {
			code: `HTTP_${response.status}`,
			message: JSON.stringify(json),
		};
	} catch {
		return {
			code: `HTTP_${response.status}`,
			message: `HTTP ${response.status}`,
		};
	}
}

/**
 * 上传图片（multipart/form-data）
 */
export const uploadImage = (
	file: File,
): E.Effect<Image, ApiErrorType> =>
	E.gen(function* () {
		const formData = new FormData();
		formData.append("file", file);

		const token = getToken();
		const headers: Record<string, string> = {};
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}

		const response = yield* E.tryPromise({
			try: async () =>
				fetch("/api/images/upload", {
					method: "POST",
					headers,
					body: formData,
				}),
			catch: (cause: unknown) => new NetworkError({ cause }),
		});

		if (!response.ok) {
			const err = yield* E.tryPromise({
				try: () => extractImageError(response),
				catch: (cause: unknown) => new NetworkError({ cause }),
			});
			return yield* E.fail(
				new HttpError({
					status: response.status,
					code: err.code,
					message: err.message,
					details: err.details,
				}),
			);
		}

		const json = yield* E.tryPromise({
			try: async () => response.json() as unknown,
			catch: (cause: unknown) => new NetworkError({ cause }),
		});

		const result = yield* Schema.decodeUnknown(ImageSchema)(json).pipe(
			E.mapError(
				(issue: unknown) => new ValidationError({ error: issue }),
			),
		);

		return result;
	});

/** 获取所有图片 */
export const listImages = (): E.Effect<PaginatedImage, ApiErrorType> =>
	request("/images", PaginatedImageSchema, {});

/** 重命名图片 */
export const renameImage = (
	id: number,
	req: RenameImageRequest,
): E.Effect<Image, ApiErrorType> =>
	request(`/images/${id}`, ImageSchema, {
		method: "PATCH",
		body: JSON.stringify(req),
	});

/** 删除图片 */
export const deleteImage = (id: number): E.Effect<void, ApiErrorType> =>
	request(`/images/${id}`, Schema.Void, { method: "DELETE" });
