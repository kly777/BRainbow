import { request, cachedRequest, tapInvalidate, CACHE } from "./request.ts";
import type { PaginatedResponse } from "./types/shared.ts";

// ── 类型 ──

export interface Chunk {
	id: number;
	content: string;
	created_at: string;
}

export interface MemItem {
	id: number;
	cue: Chunk;
	target: Chunk;
	state: string;
	stability: number;
	difficulty: number;
	due_at: string;
	lapses: number;
	leeched: boolean;
}

export interface DueResponse {
	items: readonly MemItem[];
	due_count: number;
	has_more: boolean;
	upcoming_count: number;
	all_far: boolean;
}

// ── 统计 ──

export interface MemQuery {
	q?: string;
	state?: string;
	sort?: string;
	order?: string;
	page?: number;
	page_size?: number;
}

export interface MemCounts {
	new: number;
	learning: number;
	due: number;
	buried: number;
	suspended: number;
}

export interface SessionEstimate {
	due_count: number;
	retention: number;
	total_estimate: number;
}

export const getMemCountsE = (): Promise<MemCounts> => request("/mem/counts", {});
export const getSessionEstimateE = (): Promise<SessionEstimate> => request("/mem/session-estimate", {});

// ── API ──

export const createMemE = (
	cueMd: string,
	targetMd: string,
	prerequisites: number[] = [],
): Promise<{ id: number }> =>
	request<{ id: number }>("/mem", {
		method: "POST",
		body: JSON.stringify({
			cue_content: cueMd,
			target_content: targetMd,
			prerequisites,
		}),
	}).then((r) => tapInvalidate(CACHE.mem, r));

// mem 列表（服务端搜索/筛选/排序）
export const getAllMemsE = (params?: MemQuery): Promise<PaginatedResponse<MemItem>> => {
	const qs = new URLSearchParams();
	if (params?.q) qs.set("q", params.q);
	if (params?.state) qs.set("state", params.state);
	if (params?.sort) qs.set("sort", params.sort);
	if (params?.order) qs.set("order", params.order);
	if (params?.page) qs.set("page", String(params.page));
	if (params?.page_size) qs.set("page_size", String(params.page_size));
	const suffix = qs.toString();
	return request(`/mem/all${suffix ? `?${suffix}` : ""}`, {});
};

// ⚠️ 复习数据必须实时，不缓存
export const getDueE = (limit = 50, tagIds?: number[]): Promise<DueResponse> => {
	let url = `/mem/due?limit=${limit}`;
	if (tagIds && tagIds.length > 0) {
		url += `&tag_ids=${tagIds.join(",")}`;
	}
	return request(url, {});
};

export const reviewMemE = (
	id: number,
	rating: number,
): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}/review`, {
		method: "POST",
		body: JSON.stringify({ rating }),
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const previewMemE = (
	id: number,
): Promise<{ intervals: readonly number[] }> =>
	request(`/mem/${id}/preview`, {});

export const deleteMemE = (id: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}`, { method: "DELETE" }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const buryMemE = (id: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}/bury`, { method: "POST" }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const suspendMemE = (id: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}/suspend`, { method: "POST" }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const unsuspendMemE = (id: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}/unsuspend`, { method: "POST" }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const unburyMemE = (id: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}/unbury`, { method: "POST" }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const resetMemE = (id: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}/reset`, { method: "POST" }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const batchBuryMemE = (ids: number[]): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>("/mem/batch-bury", {
		method: "POST",
		body: JSON.stringify({ ids }),
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const batchDeleteMemE = (ids: number[]): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>("/mem/batch-delete", {
		method: "POST",
		body: JSON.stringify({ ids }),
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const batchResetMemE = (ids: number[]): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>("/mem/batch-reset", {
		method: "POST",
		body: JSON.stringify({ ids }),
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const editMemE = (
	id: number,
	cue: string,
	target: string,
): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}/edit`, {
		method: "PUT",
		body: JSON.stringify({ cue_content: cue, target_content: target }),
	}).then((r) => tapInvalidate(CACHE.mem, r));

// ── 标签 ──

export interface TagInfo {
	id: number;
	name: string;
	created_at: string;
}

export interface TagMemRequest {
	mem_id: number;
	tag_id: number;
}

export interface SetTagsRequest {
	mem_id: number;
	tag_ids: number[];
}

export const createTagE = (name: string): Promise<TagInfo> =>
	request<TagInfo>("/mem/tag/create", {
		method: "POST",
		body: JSON.stringify({ name }),
	});

export const deleteTagE = (id: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/tag/delete/${id}`, { method: "DELETE" });

export const listTagsE = (): Promise<TagInfo[]> =>
	request<TagInfo[]>("/mem/tag/list", {});

export const searchTagsE = (q: string): Promise<TagInfo[]> =>
	request<TagInfo[]>(`/mem/tag/search?q=${encodeURIComponent(q)}`, {});

export const getMemTagsE = (memId: number): Promise<TagInfo[]> =>
	request<TagInfo[]>(`/mem/tag/mem/${memId}`, {});

export const addTagToMemE = (memId: number, tagId: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>("/mem/tag/mem/add", {
		method: "POST",
		body: JSON.stringify({ mem_id: memId, tag_id: tagId }),
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const removeTagFromMemE = (memId: number, tagId: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>("/mem/tag/mem/remove", {
		method: "POST",
		body: JSON.stringify({ mem_id: memId, tag_id: tagId }),
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const setMemTagsE = (memId: number, tagIds: number[]): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>("/mem/tag/mem/set", {
		method: "POST",
		body: JSON.stringify({ mem_id: memId, tag_ids: tagIds }),
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const batchAddTagToMemsE = (memIds: number[], tagId: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>("/mem/tag/batch-add", {
		method: "POST",
		body: JSON.stringify({ mem_ids: memIds, tag_id: tagId }),
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const batchRemoveTagFromMemsE = (memIds: number[], tagId: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>("/mem/tag/batch-remove", {
		method: "POST",
		body: JSON.stringify({ mem_ids: memIds, tag_id: tagId }),
	}).then((r) => tapInvalidate(CACHE.mem, r));

/** 批量获取多个 mem 的标签，返回每行 { mem_id, id, name, created_at } */
export interface MemTagRow {
	mem_id: number;
	id: number;
	name: string;
	created_at: string;
}

export const batchGetMemsTagsE = (memIds: number[]): Promise<MemTagRow[]> =>
	request<MemTagRow[]>("/mem/tag/batch-by-ids", {
		method: "POST",
		body: JSON.stringify({ ids: memIds }),
	});

export const batchSetTagsForMemsE = (memIds: number[], tagIds: number[]): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>("/mem/tag/batch-set", {
		method: "POST",
		body: JSON.stringify({ mem_ids: memIds, tag_ids: tagIds }),
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const uploadImage = async (file: File): Promise<string | null> => {
	try {
		const { uploadMedia } = await import("./mediaApi.ts");
		const item = await uploadMedia(file);
		return item.url;
	} catch {
		return null;
	}
};
