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

export type FileCategory = "image" | "video" | "audio" | "document" | "other";

export interface FileItem {
	id: number;
	stored_id: string;
	url: string;
	original_name: string;
	mime_type: string;
	file_category: FileCategory;
	size_bytes: number;
	width: number | null;
	height: number | null;
	duration_ms: number | null;
	/** 内容 SHA-256（十六进制）；存量数据可能为空 */
	content_hash?: string | null;
	tags: string[];
	meta?: Record<string, string>;
	created_at: string;
	updated_at: string;
}

/** 上传结果：duplicate=true 表示命中内容去重、复用已有文件（未新建） */
export interface UploadResult extends FileItem {
	duplicate: boolean;
}

export interface FileTag {
	id: number;
	name: string;
}

export interface UpdateFileRequest {
	original_name?: string;
	tags?: string[];
	meta?: Record<string, string>;
}

// ── API ──

/** 上传文件（支持标签）；force=true 跳过内容去重、强制新建副本 */
export const uploadFile = async (
	file: File,
	tags?: string[],
	force = false,
): Promise<UploadResult> => {
	const formData = new FormData();
	formData.append("file", file);
	const query = new URLSearchParams();
	if (tags?.length) query.set("tags", JSON.stringify(tags));
	if (force) query.set("force", "true");
	const qs = query.toString();
	return domains.files.invalidate(
		request<UploadResult>(`/file/upload${qs ? `?${qs}` : ""}`, {
			method: "POST",
			body: formData,
			timeout: false,
		}),
	);
};

/** 文件列表（缓存 30 秒） */
export const listFiles = (params?: {
	category?: string;
	tag?: string;
	q?: string;
	page?: number;
	page_size?: number;
}): Promise<PaginatedResponse<FileItem>> => {
	return cachedRequest(`/file${buildQuery(params ?? {})}`);
};

/** 单条详情（缓存 60 秒） */
export const getFile = (stored_id: string): Promise<FileItem> =>
	cachedRequest(`/file/${stored_id}`);

/** 更新文件信息（名称、标签、元信息） */
export const updateFile = (
	stored_id: string,
	data: UpdateFileRequest,
): Promise<FileItem> =>
	domains.files.invalidate(patch<FileItem>(`/file/${stored_id}`, data), {
		entity: `/file/${stored_id}`,
	});

/** 删除文件；force=true 跳过引用检查强制删除 */
export const deleteFile = (stored_id: string, force = false): Promise<void> =>
	domains.files.invalidate(
		del<void>(`/file/${stored_id}${force ? "?force=true" : ""}`),
		{ entity: `/file/${stored_id}` },
	);

/** 获取用户的所有标签 */
export const listFileTags = (): Promise<FileTag[]> =>
	cachedRequest("/file/tags");

/** 获取文件下载/预览 URL */
export const fileUrl = (stored_id: string, filename: string): string =>
	`/api/file/${stored_id}/data/${encodeURIComponent(filename)}`;
