import {
	API_BASE_URL,
	AUTH_REQUIRED_EVENT,
	buildHeaders,
	buildQuery,
	cachedRequest,
	del,
	describeGatewayStatus,
	domains,
	HttpError,
	NetworkError,
	type PaginatedResponse,
	patch,
	request,
} from "@shared/api";

// ── 类型 ──

export type FileCategory = "image" | "video" | "audio" | "document" | "other";

/** 列表排序方式（与后端 SortOrder 枚举对应） */
export type SortOrder =
	| "created_desc"
	| "created_asc"
	| "size_desc"
	| "size_asc"
	| "name_asc"
	| "name_desc";

export interface FileItem {
	id: number;
	stored_id: string;
	url: string;
	/** 缩略图地址；后端只给"能出缩略图且内容还在"的位图，宽度由前端按阶梯拼 `?w=`
	 *  （非空时可省下把原图下给 240px 卡片的那几百 MB，见 lib/thumbnail.ts） */
	thumb_url?: string | null;
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
	/** 磁盘上找不到对应文件（记录还在，内容已丢失）；文件恢复后自动变回 false */
	missing: boolean;
	/** 私密文件：仅上传者可见，内容接口需要带凭据 */
	is_private: boolean;
	/** 当前登录用户能否改名 / 改标签 / 切换可见性 / 删除（仅上传者本人） */
	can_edit: boolean;
}

/** 上传结果：duplicate=true 表示命中内容去重、复用已有文件（未新建） */
export interface UploadResult extends FileItem {
	duplicate: boolean;
}

export interface CategoryStat {
	category: string;
	count: number;
	bytes: number;
}

export interface FileStats {
	total_count: number;
	total_bytes: number;
	by_category: CategoryStat[];
}

export interface FileTag {
	id: number;
	name: string;
	/** 关联文件数（标签管理用） */
	count: number;
}

export interface UpdateFileRequest {
	original_name?: string;
	tags?: string[];
	meta?: Record<string, string>;
	/** 切换公开 / 私密 */
	is_private?: boolean;
}

// ── API ──

export interface UploadProgress {
	loaded: number;
	total: number;
}

export interface UploadOptions {
	tags?: string[];
	/** 跳过内容去重，强制新建副本 */
	force?: boolean;
	/** 客户端读到的媒体时长（毫秒，见 lib/mediaDuration.ts）；后端只对音视频采纳 */
	durationMs?: number;
	/** 上传进度回调（大文件用） */
	onProgress?: (progress: UploadProgress) => void;
}

/**
 * 带进度的上传：`fetch` 无法追踪请求体上传进度（没有 upload.onprogress 等价物），
 * 因此上传单独走 XHR；认证头、错误体解析、401 处理与 `request()` 保持一致。
 */
export const uploadFileWithProgress = (
	file: File,
	opts: UploadOptions = {},
): Promise<UploadResult> => {
	const promise = new Promise<UploadResult>((resolve, reject) => {
		const query = new URLSearchParams();
		if (opts.tags?.length) query.set("tags", JSON.stringify(opts.tags));
		if (opts.force) query.set("force", "true");
		// 时长（毫秒）：后端只对音视频采纳，值域外一律丢掉（见 service.rs 的 accept_duration）
		if (opts.durationMs && opts.durationMs > 0)
			query.set("duration_ms", String(Math.round(opts.durationMs)));
		const qs = query.toString();

		const xhr = new XMLHttpRequest();
		xhr.open("POST", `${API_BASE_URL}/file/upload${qs ? `?${qs}` : ""}`);
		// buildHeaders 对 FormData 不设 Content-Type，交给浏览器带 boundary
		for (const [key, value] of buildHeaders(undefined, new FormData())) {
			xhr.setRequestHeader(key, value);
		}

		xhr.upload.addEventListener("progress", (e) => {
			if (e.lengthComputable) {
				opts.onProgress?.({ loaded: e.loaded, total: e.total });
			}
		});

		xhr.addEventListener("load", () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					resolve(JSON.parse(xhr.responseText) as UploadResult);
				} catch (cause) {
					reject(new NetworkError({ cause }));
				}
				return;
			}

			// 错误体统一为 {code, message, details?}
			let code = `HTTP_${xhr.status}`;
			// 502/503/504 是中间层编的（后端没响应），换成能对上现象的说明 ——
			// 只回一句 "上传失败（HTTP 502）"既看不出原因也不知道要不要重试
			let message =
				describeGatewayStatus(xhr.status) ?? `上传失败（HTTP ${xhr.status}）`;
			let details: unknown;
			try {
				const body = JSON.parse(xhr.responseText) as {
					code?: string;
					message?: string;
					details?: unknown;
				};
				code = body.code ?? code;
				message = body.message ?? message;
				details = body.details;
			} catch {
				/* 非 JSON 错误体：沿用默认文案 */
			}

			if (xhr.status === 401) {
				// 与全局拦截保持一致：弹登录框
				window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
			}
			reject(new HttpError({ status: xhr.status, code, message, details }));
		});

		xhr.addEventListener("error", () => {
			reject(
				new NetworkError({
					cause: new Error("network error"),
					// 连接在传输中被断开（后端进程退出/重启、代理中断）。
					// 说"请检查网络"会把人引到错的方向：这类失败多半在服务端。
					message: "上传中断：连接被断开（服务端可能出错或正在重启）",
				}),
			);
		});
		xhr.addEventListener("abort", () => {
			reject(new NetworkError({ cause: new Error("aborted"), canceled: true }));
		});

		const formData = new FormData();
		formData.append("file", file);
		xhr.send(formData);
	});

	return domains.files.invalidate(promise);
};

/** 上传文件（支持标签）；force=true 跳过内容去重、强制新建副本 */
export const uploadFile = (
	file: File,
	tags?: string[],
	force = false,
): Promise<UploadResult> => uploadFileWithProgress(file, { tags, force });

/** 文件列表（缓存 30 秒） */
export const listFiles = (params?: {
	category?: string;
	tag?: string;
	q?: string;
	sort?: SortOrder;
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

/** 文件库统计（总量与类别分布，缓存 30 秒） */
export const getFileStats = (): Promise<FileStats> =>
	cachedRequest("/file/stats");

/** 获取用户的所有标签（含关联文件数） */
export const listFileTags = (): Promise<FileTag[]> =>
	cachedRequest("/file/tags");

/** 重命名标签 */
export const renameFileTag = (id: number, name: string): Promise<void> =>
	domains.files.invalidate(patch<void>(`/file/tags/${id}`, { name }));

/** 删除标签（仅解除与文件的关联，文件保留） */
export const deleteFileTag = (id: number): Promise<void> =>
	domains.files.invalidate(del<void>(`/file/tags/${id}`));

/** 合并标签：把 fromId 合并进 targetId */
export const mergeFileTag = (fromId: number, targetId: number): Promise<void> =>
	domains.files.invalidate(
		request<void>(`/file/tags/${fromId}/merge`, {
			method: "POST",
			body: JSON.stringify({ target_id: targetId }),
		}),
	);

/** 文件 URL 由后端在响应里给出（`FileItem.url`），前端不再自行拼接 */
