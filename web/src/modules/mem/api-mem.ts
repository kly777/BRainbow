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

import { buildQuery, del, post, put, request, resource } from "@shared/api";

const mem = resource("mem");

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
	mem.invalidate(
		post<{ id: number }>("/mem", {
			cue_content: cueMd,
			target_content: targetMd,
			prerequisites,
		}),
	);

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
	durationSecs = 0,
): Promise<{ ok: boolean }> =>
	mem.invalidate(
		post<{ ok: boolean }>(`/mem/${id}/review`, {
			rating,
			duration_secs: durationSecs,
		}),
	);

export const undoReviewE = (
	id: number,
	undoData: Record<string, unknown>,
): Promise<{ ok: boolean }> =>
	mem.invalidate(post<{ ok: boolean }>(`/mem/${id}/undo`, undoData));

export const previewMemE = (
	id: number,
): Promise<{ intervals: readonly number[] }> =>
	request(`/mem/${id}/preview`, {});

export const deleteMemE = (id: number): Promise<{ ok: boolean }> =>
	mem.invalidate(del<{ ok: boolean }>(`/mem/${id}`));

export const buryMemE = (id: number): Promise<{ ok: boolean }> =>
	mem.invalidate(
		request<{ ok: boolean }>(`/mem/${id}/bury`, { method: "POST" }),
	);

export const suspendMemE = (id: number): Promise<{ ok: boolean }> =>
	mem.invalidate(
		request<{ ok: boolean }>(`/mem/${id}/suspend`, { method: "POST" }),
	);

export const unsuspendMemE = (id: number): Promise<{ ok: boolean }> =>
	mem.invalidate(
		request<{ ok: boolean }>(`/mem/${id}/unsuspend`, { method: "POST" }),
	);

export const unburyMemE = (id: number): Promise<{ ok: boolean }> =>
	mem.invalidate(
		request<{ ok: boolean }>(`/mem/${id}/unbury`, { method: "POST" }),
	);

export const resetMemE = (id: number): Promise<{ ok: boolean }> =>
	mem.invalidate(
		request<{ ok: boolean }>(`/mem/${id}/reset`, { method: "POST" }),
	);

export const batchBuryMemE = (ids: number[]): Promise<BatchResponse> =>
	mem.invalidate(post<BatchResponse>("/mem/batch-bury", { items: ids }));

export const batchDeleteMemE = (ids: number[]): Promise<BatchResponse> =>
	mem.invalidate(post<BatchResponse>("/mem/batch-delete", { items: ids }));

export const batchResetMemE = (ids: number[]): Promise<BatchResponse> =>
	mem.invalidate(post<BatchResponse>("/mem/batch-reset", { items: ids }));

export const editMemE = (
	id: number,
	cue: string,
	target: string,
): Promise<{ ok: boolean }> =>
	mem.invalidate(
		put<{ ok: boolean }>(`/mem/${id}/edit`, {
			cue_content: cue,
			target_content: target,
		}),
	);
