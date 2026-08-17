// ── 记忆 CRUD / 复习队列 / 批量操作 API ──

export const getMemCountsE = (): Promise<MemCounts> =>
	request("/mem/counts", {});
export const getSessionEstimateE = (params?: {
	tag_ids?: number[];
	exclude_tag_ids?: number[];
}): Promise<SessionEstimate> => {
	const suffix = buildQuery({
		tag_ids: params?.tag_ids?.join(","),
		exclude_tag_ids: params?.exclude_tag_ids?.join(","),
	}).slice(1);
	return request(`/mem/session-estimate${suffix ? `?${suffix}` : ""}`, {});
};

import {
	buildQuery,
	CACHE,
	del,
	post,
	put,
	request,
	tapInvalidate,
} from "@lib/api";
import type {
	BatchResponse,
	DueResponse,
	MemCounts,
	MemItem,
	MemQuery,
	PaginatedResponse,
	SessionEstimate,
} from "./api-types.ts";

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
	const suffix = buildQuery({ ...(params ?? {}) }).slice(1);
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
	post<{ ok: boolean }>(`/mem/${id}/review`, { rating }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const previewMemE = (
	id: number,
): Promise<{ intervals: readonly number[] }> =>
	request(`/mem/${id}/preview`, {});

export const deleteMemE = (id: number): Promise<{ ok: boolean }> =>
	del<{ ok: boolean }>(`/mem/${id}`).then((r) => tapInvalidate(CACHE.mem, r));

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
	post<BatchResponse>("/mem/batch-bury", { items: ids }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const batchDeleteMemE = (ids: number[]): Promise<BatchResponse> =>
	post<BatchResponse>("/mem/batch-delete", { items: ids }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const batchResetMemE = (ids: number[]): Promise<BatchResponse> =>
	post<BatchResponse>("/mem/batch-reset", { items: ids }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const editMemE = (
	id: number,
	cue: string,
	target: string,
): Promise<{ ok: boolean }> =>
	put<{ ok: boolean }>(`/mem/${id}/edit`, {
		cue_content: cue,
		target_content: target,
	}).then((r) => tapInvalidate(CACHE.mem, r));
