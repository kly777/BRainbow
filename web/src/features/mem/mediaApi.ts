import { del, patch, request } from "@apis/request.ts";
import { CACHE, cachedRequest, tapInvalidate } from "@apis/cache.ts";

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

// ── API ──

/** 上传媒体文件 */
export const uploadMedia = async (file: File): Promise<MediaItem> => {
	const formData = new FormData();
	formData.append("file", file);
	return request<MediaItem>("/media/upload", {
		method: "POST",
		body: formData,
	});
};

/** 媒体列表（缓存 30 秒） */
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
	return cachedRequest(`/media${suffix}`, {});
};

/** 单条详情（缓存 60 秒） */
export const getMediaE = (stored_id: string): Promise<MediaItem> =>
	cachedRequest(`/media/${stored_id}`, {}, 60_000);

/** 重命名 */
export const renameMediaE = (
	stored_id: string,
	original_name: string,
): Promise<MediaItem> =>
	patch<MediaItem>(`/media/${stored_id}`, { original_name }).then((r) => tapInvalidate(CACHE.media, r));

/** 删除 */
export const deleteMediaE = (stored_id: string): Promise<void> =>
	del<void>(`/media/${stored_id}`).then((r) =>
		tapInvalidate(CACHE.media, r),
	);
