import {
	buildQuery,
	CACHE,
	cachedRequest,
	del,
	invalidateCache,
	patch,
	post,
	request,
	tapInvalidate,
} from "@lib/api";

export interface Bookmark {
	id: number;
	title: string;
	url: string;
	description: string;
	tags: string[];
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

export interface PaginatedBookmarks {
	items: Bookmark[];
	total: number;
	page: number;
	page_size: number;
	total_pages: number;
}

export const getBookmarksE = (
	page = 1,
	pageSize = 20,
	tag?: string,
): Promise<PaginatedBookmarks> => {
	return cachedRequest(
		`/bookmarks${buildQuery({ page, page_size: pageSize, tag })}`,
		{},
	);
};

export const createBookmarkE = (bm: CreateBookmarkRequest): Promise<Bookmark> =>
	post<Bookmark>("/bookmarks", bm).then((r) =>
		tapInvalidate(CACHE.bookmarks, r),
	);

export const updateBookmarkE = (
	id: number,
	bm: UpdateBookmarkRequest,
): Promise<Bookmark> =>
	patch<Bookmark>(`/bookmarks/${id}`, bm).then((r) =>
		tapInvalidate(CACHE.bookmarks, r),
	);

export const deleteBookmarkE = (id: number): Promise<void> =>
	del<void>(`/bookmarks/${id}`).then((r) => tapInvalidate(CACHE.bookmarks, r));

export const searchBookmarksE = (
	query: string,
	page = 1,
	pageSize = 20,
	tag?: string,
): Promise<PaginatedBookmarks> => {
	return cachedRequest(
		`/bookmarks/search${buildQuery({ q: query, page, page_size: pageSize, tag })}`,
		{},
	);
};

// ── 标签 ──

/** 搜索标签（带使用次数），q 为空返回全部 */
export const searchBookmarkTagsE = (q = ""): Promise<BookmarkTagWithCount[]> =>
	cachedRequest(
		`/bookmarks/tags${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
		{},
	);

/** 设置书签标签（按名称整体替换，自动创建新标签） */
export const setBookmarkTagsE = (
	id: number,
	tags: string[],
): Promise<BookmarkTag[]> =>
	request<BookmarkTag[]>(`/bookmarks/${id}/tags`, {
		method: "PUT",
		body: JSON.stringify({ tags }),
	}).then((r) => tapInvalidate(CACHE.bookmarks, r));

/** 删除标签 */
export const deleteBookmarkTagE = (id: number): Promise<void> =>
	del<void>(`/bookmarks/tags/${id}`).then((r) =>
		tapInvalidate(CACHE.bookmarks, r),
	);

/** 导入 Firefox 书签 HTML */
export const importBookmarksE = async (file: File): Promise<ImportResult> => {
	const formData = new FormData();
	formData.append("file", file);
	const result = await request<ImportResult>("/bookmarks/import", {
		method: "POST",
		body: formData,
		// 书签 HTML 导入可到 64MB，不做 15s 默认超时
		timeout: false,
	});
	invalidateCache(CACHE.bookmarks);
	return result;
};
