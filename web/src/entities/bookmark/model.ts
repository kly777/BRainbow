// ── 书签模块类型 ──

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
