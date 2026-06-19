import { request } from "./request.ts";

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
	request("/mem", {
		method: "POST",
		body: JSON.stringify({
			cue_content: cueMd,
			target_content: targetMd,
			prerequisites,
		}),
	});

export const getAllMemsE = (pageSize = 200): Promise<DueResponse> =>
	request(`/mem/all?page_size=${pageSize}`, {});

export const getDueE = (limit = 50): Promise<DueResponse> =>
	request(`/mem/due?limit=${limit}`, {});

export const reviewMemE = (
	id: number,
	rating: number,
): Promise<{ ok: boolean }> =>
	request(`/mem/${id}/review`, {
		method: "POST",
		body: JSON.stringify({ rating }),
	});

export const previewMemE = (
	id: number,
): Promise<{ intervals: readonly number[] }> =>
	request(`/mem/${id}/preview`, {});

export const deleteMemE = (id: number): Promise<{ ok: boolean }> =>
	request(`/mem/${id}`, { method: "DELETE" });

export const buryMemE = (id: number): Promise<{ ok: boolean }> =>
	request(`/mem/${id}/bury`, { method: "POST" });

export const unburyMemE = (id: number): Promise<{ ok: boolean }> =>
	request(`/mem/${id}/unbury`, { method: "POST" });

export const resetMemE = (id: number): Promise<{ ok: boolean }> =>
	request(`/mem/${id}/reset`, { method: "POST" });

export const editMemE = (
	id: number,
	cue: string,
	target: string,
): Promise<{ ok: boolean }> =>
	request(`/mem/${id}/edit`, {
		method: "PUT",
		body: JSON.stringify({ cue_content: cue, target_content: target }),
	});

export const uploadImage = async (file: File): Promise<string | null> => {
	try {
		const { uploadMedia } = await import("./mediaApi.ts");
		const item = await uploadMedia(file);
		return item.url;
	} catch {
		return null;
	}
};
