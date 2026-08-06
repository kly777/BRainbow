import { del, patch, post, request } from "@apis/request.ts";
import { CACHE, cachedRequest, invalidateCache, tapInvalidate } from "@apis/cache.ts";
import type {
	Bookmark,
	BookmarkTag,
	BookmarkTagWithCount,
	CreateBookmarkRequest,
	ImportResult,
	PaginatedBookmarks,
	UpdateBookmarkRequest,
} from "@features/bookmark/types.ts";

export const getBookmarksE = (
	page = 1,
	pageSize = 20,
	tag?: string,
): Promise<PaginatedBookmarks> => {
	const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
	if (tag) qs.set("tag", tag);
	return cachedRequest(`/bookmarks?${qs}`, {});
};

export const createBookmarkE = (bm: CreateBookmarkRequest): Promise<Bookmark> =>
	post<Bookmark>("/bookmarks", bm).then((r) => tapInvalidate(CACHE.bookmarks, r));

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
	const qs = new URLSearchParams({
		q: query,
		page: String(page),
		page_size: String(pageSize),
	});
	if (tag) qs.set("tag", tag);
	return cachedRequest(`/bookmarks/search?${qs}`, {});
};

// ── 标签 ──

/** 搜索标签（带使用次数），q 为空返回全部 */
export const searchBookmarkTagsE = (q = ""): Promise<BookmarkTagWithCount[]> =>
	cachedRequest(
		`/bookmarks/tags${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
		{},
	);

/** 设置书签标签（按名称整体替换，自动创建新标签） */
export const setBookmarkTagsE = (id: number, tags: string[]): Promise<BookmarkTag[]> =>
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
	});
	invalidateCache(CACHE.bookmarks);
	return result;
};
