import {
	buildQuery,
	cachedRequest,
	del,
	domains,
	type PaginatedResponse,
	patch,
	request,
} from "@shared/api";

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

// ── API ──

/** 上传媒体文件（成功后失效媒体列表缓存，否则 30-60s 内看不到新条目） */
export const uploadMedia = async (file: File): Promise<MediaItem> => {
	const formData = new FormData();
	formData.append("file", file);
	return domains.media.invalidate(
		request<MediaItem>("/media/upload", {
			method: "POST",
			body: formData,
			// 大文件上传不做 15s 默认超时
			timeout: false,
		}),
	);
};

/** 媒体列表（缓存 30 秒） */
export const listMediaE = (params?: {
	media_type?: string;
	page?: number;
	page_size?: number;
}): Promise<PaginatedResponse<MediaItem>> => {
	return cachedRequest(`/media${buildQuery(params ?? {})}`);
};

/** 单条详情（缓存 60 秒） */
export const getMediaE = (stored_id: string): Promise<MediaItem> =>
	cachedRequest(`/media/${stored_id}`);

/** 重命名 */
export const renameMediaE = (
	stored_id: string,
	original_name: string,
): Promise<MediaItem> =>
	domains.media.invalidate(
		patch<MediaItem>(`/media/${stored_id}`, { original_name }),
		{ entity: `/media/${stored_id}` },
	);

/** 删除；force=true 跳过引用检查强制删除 */
export const deleteMediaE = (stored_id: string, force = false): Promise<void> =>
	domains.media.invalidate(
		del<void>(`/media/${stored_id}${force ? "?force=true" : ""}`),
		{ entity: `/media/${stored_id}` },
	);
