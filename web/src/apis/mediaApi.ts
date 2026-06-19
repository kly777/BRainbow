import { request } from "./request.ts";
import { getToken } from "../auth/context.tsx";
import { HttpError, NetworkError } from "./types/index.ts";

// ── 类型 ──

export type MediaType = "image" | "video" | "audio";

export interface MediaItem {
	stored_id: string;
	url: string;
	original_name: string;
	media_type: MediaType;
	mime_type: string;
	size_bytes: number;
	width: number | null;
	height: number | null;
	duration_ms: number | null;
	created_at: string;
}

export interface PaginatedMedia {
	items: MediaItem[];
	total: number;
	page: number;
	page_size: number;
	total_pages: number;
}

// ── 内部辅助 ──

async function extractError(response: Response): Promise<{
	code: string;
	message: string;
	details?: unknown;
}> {
	try {
		const json = await response.json();
		if (
			json &&
			typeof json.code === "string" &&
			typeof json.message === "string"
		) {
			return { code: json.code, message: json.message, details: json.details };
		}
		return { code: `HTTP_${response.status}`, message: JSON.stringify(json) };
	} catch {
		return {
			code: `HTTP_${response.status}`,
			message: `HTTP ${response.status}`,
		};
	}
}

// ── API ──

/** 上传媒体文件 */
export const uploadMedia = async (file: File): Promise<MediaItem> => {
	const formData = new FormData();
	formData.append("file", file);

	const token = getToken();
	const headers: Record<string, string> = {};
	if (token) headers.Authorization = `Bearer ${token}`;

	let response: Response;
	try {
		response = await fetch("/api/media/upload", {
			method: "POST",
			headers,
			body: formData,
		});
	} catch (cause: unknown) {
		throw new NetworkError({ cause });
	}

	if (!response.ok) {
		const err = await extractError(response);
		throw new HttpError({
			status: response.status,
			code: err.code,
			message: err.message,
			details: err.details,
		});
	}

	return response.json() as Promise<MediaItem>;
};

/** 媒体列表 */
export const listMediaE = (params?: {
	media_type?: string;
	page?: number;
	page_size?: number;
}): Promise<PaginatedMedia> => {
	const qs = new URLSearchParams();
	if (params?.media_type) qs.set("media_type", params.media_type);
	if (params?.page) qs.set("page", String(params.page));
	if (params?.page_size) qs.set("page_size", String(params.page_size));
	const suffix = qs.toString() ? `?${qs.toString()}` : "";
	return request(`/media${suffix}`, {});
};

/** 单条详情 */
export const getMediaE = (stored_id: string): Promise<MediaItem> =>
	request(`/media/${stored_id}`, {});

/** 重命名 */
export const renameMediaE = (
	stored_id: string,
	original_name: string,
): Promise<MediaItem> =>
	request(`/media/${stored_id}`, {
		method: "PATCH",
		body: JSON.stringify({ original_name }),
	});

/** 删除 */
export const deleteMediaE = (stored_id: string): Promise<void> =>
	request(`/media/${stored_id}`, { method: "DELETE" });
