// ── 记忆模块 API ──

import { del, post, put, request } from "@apis/request.ts";
import { CACHE, tapInvalidate } from "@apis/cache.ts";
import { tryAsync, unwrapOrNull } from "@lib/result.ts";
import type {
	BatchDataResponse,
	BatchResponse,
	PaginatedResponse,
} from "@apis/types/shared.ts";

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
	mnemonic?: string | null;
}

export interface DueResponse {
	items: readonly MemItem[];
	due_count: number;
	has_more: boolean;
	upcoming_count: number;
	all_far: boolean;
}

export interface MemQuery {
	q?: string;
	state?: string;
	sort?: string;
	order?: string;
	tag_ids?: string;
	exclude_tag_ids?: string;
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

export const getMemCountsE = (): Promise<MemCounts> =>
	request("/mem/counts", {});
export const getSessionEstimateE = (): Promise<SessionEstimate> =>
	request("/mem/session-estimate", {});

// ── API ──

export const createMemE = (
	cueMd: string,
	targetMd: string,
	prerequisites: number[] = [],
): Promise<{ id: number }> =>
	post<{ id: number }>("/mem", {
			cue_content: cueMd,
			target_content: targetMd,
			prerequisites,
		}).then((r) => tapInvalidate(CACHE.mem, r));

export const getAllMemsE = (
	params?: MemQuery,
): Promise<PaginatedResponse<MemItem>> => {
	const qs = new URLSearchParams();
	if (params?.q) qs.set("q", params.q);
	if (params?.state) qs.set("state", params.state);
	if (params?.sort) qs.set("sort", params.sort);
	if (params?.order) qs.set("order", params.order);
	if (params?.tag_ids) qs.set("tag_ids", params.tag_ids);
	if (params?.exclude_tag_ids)
		qs.set("exclude_tag_ids", params.exclude_tag_ids);
	if (params?.page) qs.set("page", String(params.page));
	if (params?.page_size) qs.set("page_size", String(params.page_size));
	const suffix = qs.toString();
	return request(`/mem/all${suffix ? `?${suffix}` : ""}`, {});
};

export const getDueE = (
	limit = 50,
	tagIds?: number[],
	excludeIds?: number[],
): Promise<DueResponse> => {
	let url = `/mem/due?limit=${limit}`;
	if (tagIds && tagIds.length > 0) {
		url += `&tag_ids=${tagIds.join(",")}`;
	}
	if (excludeIds && excludeIds.length > 0) {
		url += `&exclude_tag_ids=${excludeIds.join(",")}`;
	}
	return request(url, {});
};

export const reviewMemE = (
	id: number,
	rating: number,
): Promise<{ ok: boolean }> =>
	post<{ ok: boolean }>(`/mem/${id}/review`, { rating }).then((r) => tapInvalidate(CACHE.mem, r));

export const previewMemE = (
	id: number,
): Promise<{ intervals: readonly number[] }> =>
	request(`/mem/${id}/preview`, {});

export const deleteMemE = (id: number): Promise<{ ok: boolean }> =>
	del<{ ok: boolean }>(`/mem/${id}`).then((r) =>
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
	request<{ ok: boolean }>(`/mem/${id}/unsuspend`, { method: "POST" }).then(
		(r) => tapInvalidate(CACHE.mem, r),
	);

export const unburyMemE = (id: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}/unbury`, { method: "POST" }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const resetMemE = (id: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}/reset`, { method: "POST" }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const batchBuryMemE = (ids: number[]): Promise<BatchResponse> =>
	post<BatchResponse>("/mem/batch-bury", { items: ids }).then((r) => tapInvalidate(CACHE.mem, r));

export const batchDeleteMemE = (ids: number[]): Promise<BatchResponse> =>
	post<BatchResponse>("/mem/batch-delete", { items: ids }).then((r) => tapInvalidate(CACHE.mem, r));

export const batchResetMemE = (ids: number[]): Promise<BatchResponse> =>
	post<BatchResponse>("/mem/batch-reset", { items: ids }).then((r) => tapInvalidate(CACHE.mem, r));

export const editMemE = (
	id: number,
	cue: string,
	target: string,
): Promise<{ ok: boolean }> =>
	put<{ ok: boolean }>(`/mem/${id}/edit`, { cue_content: cue, target_content: target }).then((r) => tapInvalidate(CACHE.mem, r));

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
	post<TagInfo>("/mem/tag/create", { name });

export const deleteTagE = (id: number): Promise<{ ok: boolean }> =>
	del<{ ok: boolean }>(`/mem/tag/delete/${id}`);

export const listTagsE = (): Promise<TagInfo[]> =>
	request<TagInfo[]>("/mem/tag/list", {});

export const searchTagsE = (q: string): Promise<TagInfo[]> =>
	request<TagInfo[]>(`/mem/tag/search?q=${encodeURIComponent(q)}`, {});

export const getMemTagsE = (memId: number): Promise<TagInfo[]> =>
	request<TagInfo[]>(`/mem/tag/mem/${memId}`, {});

export const addTagToMemE = (
	memId: number,
	tagId: number,
): Promise<{ ok: boolean }> =>
	post<{ ok: boolean }>("/mem/tag/mem/add", { mem_id: memId, tag_id: tagId }).then((r) => tapInvalidate(CACHE.mem, r));

export const removeTagFromMemE = (
	memId: number,
	tagId: number,
): Promise<{ ok: boolean }> =>
	post<{ ok: boolean }>("/mem/tag/mem/remove", { mem_id: memId, tag_id: tagId }).then((r) => tapInvalidate(CACHE.mem, r));

export const setMemTagsE = (
	memId: number,
	tagIds: number[],
): Promise<{ ok: boolean }> =>
	post<{ ok: boolean }>("/mem/tag/mem/set", { mem_id: memId, tag_ids: tagIds }).then((r) => tapInvalidate(CACHE.mem, r));

export const batchAddTagToMemsE = (
	memIds: number[],
	tagId: number,
): Promise<BatchResponse> =>
	post<BatchResponse>("/mem/tag/batch-add", { items: memIds, tag_id: tagId }).then((r) => tapInvalidate(CACHE.mem, r));

export const batchRemoveTagFromMemsE = (
	memIds: number[],
	tagId: number,
): Promise<BatchResponse> =>
	post<BatchResponse>("/mem/tag/batch-remove", { items: memIds, tag_id: tagId }).then((r) => tapInvalidate(CACHE.mem, r));

export interface MemTagRow {
	mem_id: number;
	id: number;
	name: string;
	created_at: string;
}

export const batchGetMemsTagsE = (
	memIds: number[],
): Promise<BatchDataResponse<MemTagRow>> =>
	request<BatchDataResponse<MemTagRow>>("/mem/tag/batch-by-ids", {
		method: "POST",
		body: JSON.stringify({ items: memIds }),
	});

export const batchSetTagsForMemsE = (
	memIds: number[],
	tagIds: number[],
): Promise<BatchResponse> =>
	post<BatchResponse>("/mem/tag/batch-set", { items: memIds, tag_ids: tagIds }).then((r) => tapInvalidate(CACHE.mem, r));

// ── CSV 导入导出 ──

export async function downloadExportCsv(tagIds?: number[]): Promise<void> {
	const token = (await import("@auth/context.tsx")).getToken();
	const headers: Record<string, string> = {};
	if (token) headers.Authorization = `Bearer ${token}`;

	let url = "/api/mem/export/csv";
	if (tagIds && tagIds.length > 0) {
		url += `?tag_ids=${tagIds.join(",")}`;
	}

	const response = await fetch(url, { headers });
	if (!response.ok) {
		const err = await response.text();
		throw new Error(err || "导出失败");
	}
	const blob = await response.blob();
	const downloadUrl = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = downloadUrl;
	a.download = `mems_${new Date().toISOString().slice(0, 10)}.csv`;
	a.click();
	URL.revokeObjectURL(downloadUrl);
}

export interface ImportCsvResult {
	imported: number;
	errors: string[];
}

export const importCsvE = (
	csvContent: string,
	defaultTags?: string[],
): Promise<ImportCsvResult> =>
	post<ImportCsvResult>("/mem/import/csv", { csv: csvContent, default_tags: defaultTags ?? [] }).then((r) => tapInvalidate(CACHE.mem, r));

export const importPsvE = (
	psvContent: string,
	defaultTags?: string[],
): Promise<ImportCsvResult> =>
	post<ImportCsvResult>("/mem/import/psv", { csv: psvContent, default_tags: defaultTags ?? [] }).then((r) => tapInvalidate(CACHE.mem, r));

export interface ImportJsonItem {
	cue: string;
	target: string;
	tags?: string[];
}

export interface ImportJsonResult {
	imported: number;
	errors: string[];
}

export const importJsonE = (
	mems: ImportJsonItem[],
	defaultTags?: string[],
): Promise<ImportJsonResult> =>
	post<ImportJsonResult>("/mem/import/json", { mems, default_tags: defaultTags ?? [] }).then((r) => tapInvalidate(CACHE.mem, r));

export const uploadImage = async (file: File): Promise<string | null> => {
	const result = await tryAsync(async () => {
		const { uploadMedia } = await import("@features/mem/mediaApi.ts");
		const item = await uploadMedia(file);
		return item.url;
	});
	return unwrapOrNull(result);
};

// ── AI 助记 ──

export const getMnemonicE = (
	memId: number,
): Promise<{ content: string | null }> => request(`/mem/${memId}/mnemonic`, {});

export const setMnemonicE = (
	memId: number,
	content: string,
): Promise<{ ok: boolean }> =>
	put<{ ok: boolean }>(`/mem/${memId}/mnemonic`, { content });

export interface UpcomingCounts {
	within_8h: number;
	within_24h: number;
}

export const getUpcomingCountsE = (): Promise<UpcomingCounts> =>
	request("/mem/upcoming-counts", {});

// ── 类型 re-export（保持向后兼容） ──
export type {
	BatchDataResponse,
	BatchResponse,
	PaginatedResponse,
} from "@apis/types/shared.ts";
