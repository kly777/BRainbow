import {
	buildQuery,
	cachedRequest,
	del,
	type PaginatedResponse,
	patch,
	post,
	request,
	resource,
} from "@shared/api";

const bookmarks = resource("bookmarks");

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

export const getBookmarksE = (
	page = 1,
	pageSize = 20,
	tag?: string,
): Promise<PaginatedResponse<Bookmark>> => {
	return cachedRequest(
		`/bookmarks${buildQuery({ page, page_size: pageSize, tag })}`,
		{},
	);
};

export const getBookmarkE = (id: number): Promise<Bookmark> =>
	cachedRequest<Bookmark>(`/bookmarks/${id}`, {});

export const createBookmarkE = (bm: CreateBookmarkRequest): Promise<Bookmark> =>
	bookmarks.invalidate(post<Bookmark>("/bookmarks", bm));

export const updateBookmarkE = (
	id: number,
	bm: UpdateBookmarkRequest,
): Promise<Bookmark> =>
	bookmarks.invalidate(patch<Bookmark>(`/bookmarks/${id}`, bm));

export const deleteBookmarkE = (id: number): Promise<void> =>
	bookmarks.invalidate(del<void>(`/bookmarks/${id}`));

export const searchBookmarksE = (
	query: string,
	page = 1,
	pageSize = 20,
	tag?: string,
): Promise<PaginatedResponse<Bookmark>> => {
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
	bookmarks.invalidate(
		request<BookmarkTag[]>(`/bookmarks/${id}/tags`, {
			method: "PUT",
			body: JSON.stringify({ tags }),
		}),
	);

/** 删除标签 */
export const deleteBookmarkTagE = (id: number): Promise<void> =>
	bookmarks.invalidate(del<void>(`/bookmarks/tags/${id}`));

/** 导入 Firefox 书签 HTML */
export const importBookmarksE = async (file: File): Promise<ImportResult> => {
	const formData = new FormData();
	formData.append("file", file);
	return bookmarks.invalidate(
		request<ImportResult>("/bookmarks/import", {
			method: "POST",
			body: formData,
			// 书签 HTML 导入可到 64MB，不做 15s 默认超时
			timeout: false,
		}),
	);
};
