import {
	buildQuery,
	cachedRequest,
	del,
	domains,
	type PaginatedResponse,
	patch,
	post,
	request,
} from "@shared/api";

export interface Bookmark {
	id: number;
	title: string;
	url: string;
	description: string;
	tags: string[];
	visit_count: number;
	created_at: string;
	updated_at: string;
}

export interface BookmarkTag {
	id: number;
	name: string;
}

export interface BookmarkTagWithCount extends BookmarkTag {
	count: number;
}

export interface CreateBookmarkRequest {
	title: string;
	url: string;
	description?: string;
	tags?: string[];
}

export interface UpdateBookmarkRequest {
	title?: string;
	url?: string;
	description?: string;
}

export interface SetBookmarkTagsRequest {
	tags: string[];
}

export interface ImportResult {
	total: number;
	created: number;
	merged: number;
}

export interface CheckUrlResponse {
	exists: boolean;
	bookmark: Bookmark | null;
}

export interface FetchUrlResponse {
	url: string;
	title: string;
}

export interface SuggestTagsResponse {
	tags: string[];
}

export const getBookmarksE = (
	page = 1,
	pageSize = 20,
	tag?: string,
): Promise<PaginatedResponse<Bookmark>> => {
	return cachedRequest(
		`/bookmarks${buildQuery({ page, page_size: pageSize, tag })}`,
	);
};

export const getBookmarkE = (id: number): Promise<Bookmark> =>
	cachedRequest<Bookmark>(`/bookmarks/${id}`);

export const createBookmarkE = (bm: CreateBookmarkRequest): Promise<Bookmark> =>
	domains.bookmarks.invalidate(post<Bookmark>("/bookmarks", bm));

export const updateBookmarkE = (
	id: number,
	bm: UpdateBookmarkRequest,
): Promise<Bookmark> =>
	domains.bookmarks.invalidate(patch<Bookmark>(`/bookmarks/${id}`, bm), {
		entity: `/bookmarks/${id}`,
	});

export const deleteBookmarkE = (id: number): Promise<void> =>
	domains.bookmarks.invalidate(del<void>(`/bookmarks/${id}`), {
		entity: `/bookmarks/${id}`,
	});

export const searchBookmarksE = (
	query: string,
	page = 1,
	pageSize = 20,
	tag?: string,
): Promise<PaginatedResponse<Bookmark>> => {
	return cachedRequest(
		`/bookmarks/search${buildQuery({ q: query, page, page_size: pageSize, tag })}`,
	);
};

// ── 标签 ──

/** 搜索标签（带使用次数），q 为空返回全部 */
export const searchBookmarkTagsE = (q = ""): Promise<BookmarkTagWithCount[]> =>
	cachedRequest(
		`/bookmarks/tags${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
	);

/** 设置书签标签（按名称整体替换，自动创建新标签） */
export const setBookmarkTagsE = (
	id: number,
	tags: string[],
): Promise<BookmarkTag[]> =>
	domains.bookmarks.invalidate(
		request<BookmarkTag[]>(`/bookmarks/${id}/tags`, {
			method: "PUT",
			body: JSON.stringify({ tags }),
		}),
		{ entity: `/bookmarks/${id}` },
	);

/** 删除标签 */
export const deleteBookmarkTagE = (id: number): Promise<void> =>
	domains.bookmarks.invalidate(del<void>(`/bookmarks/tags/${id}`));

/** 导入 Firefox 书签 HTML */
export const importBookmarksE = async (file: File): Promise<ImportResult> => {
	const formData = new FormData();
	formData.append("file", file);
	return domains.bookmarks.invalidate(
		request<ImportResult>("/bookmarks/import", {
			method: "POST",
			body: formData,
			// 书签 HTML 导入可到 64MB，不做 15s 默认超时
			timeout: false,
		}),
	);
};

/** 检查 URL 是否已被收藏 */
export const checkBookmarkUrlE = (url: string): Promise<CheckUrlResponse> =>
	cachedRequest(`/bookmarks/check-url?url=${encodeURIComponent(url.trim())}`);

/** 通过 URL 抓取网页标题 */
export const fetchUrlTitleE = (url: string): Promise<FetchUrlResponse> =>
	request<FetchUrlResponse>("/bookmarks/fetch-url", {
		method: "POST",
		body: JSON.stringify({ url: url.trim() }),
	});

/** AI 建议标签 */
export const suggestBookmarkTagsE = (
	id: number,
): Promise<SuggestTagsResponse> =>
	request<SuggestTagsResponse>(`/bookmarks/${id}/suggest-tags`, {
		method: "POST",
	});

/** 批量删除书签 */
export const batchDeleteBookmarksE = (ids: number[]): Promise<void> =>
	domains.bookmarks.invalidate(
		request<void>("/bookmarks/batch-delete", {
			method: "POST",
			body: JSON.stringify({ ids }),
		}),
	);

/** 记录书签访问（visit_count += 1） */
export const incrementBookmarkVisitE = (id: number): Promise<void> =>
	request<void>(`/bookmarks/${id}/visit`, { method: "POST" });

export interface TagGroup {
	tag: string;
	total_visits: number;
	bookmarks: Bookmark[];
}

export interface GroupedBookmarksResponse {
	groups: TagGroup[];
	untagged: Bookmark[];
}

/** 按标签分组获取书签 */
export const getGroupedBookmarksE = (): Promise<GroupedBookmarksResponse> =>
	cachedRequest<GroupedBookmarksResponse>("/bookmarks/grouped-by-tag");
