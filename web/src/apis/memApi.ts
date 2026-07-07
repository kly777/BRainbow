import { request, cachedRequest, tapInvalidate, CACHE } from "./request.ts";

// ── 类型 ──

export interface Chunk {
	id: number;
	content: string;
}

export interface MemItem {
	id: number;
	cue: Chunk;
	target: Chunk;
	state: string;
	stability: number;
	difficulty: number;
	due_at: string;
}

export interface DueResponse {
	items: readonly MemItem[];
	due_count: number;
	has_more: boolean;
	upcoming_count: number;
	all_far: boolean;
}

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

// mem 列表缓存 10 秒（不常刷新）
export const getAllMemsE = (pageSize = 200): Promise<DueResponse> =>
	cachedRequest(`/mem/all?page_size=${pageSize}`, {}, 10_000);

// ⚠️ 复习数据必须实时，不缓存
export const getDueE = (limit = 50): Promise<DueResponse> =>
	request(`/mem/due?limit=${limit}`, {});

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

export const unburyMemE = (id: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}/unbury`, { method: "POST" }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const resetMemE = (id: number): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}/reset`, { method: "POST" }).then((r) =>
		tapInvalidate(CACHE.mem, r),
	);

export const editMemE = (
	id: number,
	cue: string,
	target: string,
): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/mem/${id}/edit`, {
		method: "PUT",
		body: JSON.stringify({ cue_content: cue, target_content: target }),
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
