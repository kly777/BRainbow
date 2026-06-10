import { request } from "./request.ts";
import { getToken } from "../auth/context.tsx";

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

export const createMem = (
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

export const getAllMems = (
    pageSize = 200,
): Promise<DueResponse> =>
    request(`/mem/all?page_size=${pageSize}`, {});

export const getDue = (
    limit = 50,
): Promise<DueResponse> =>
    request(`/mem/due?limit=${limit}`, {});

export const reviewMem = (
    id: number,
    rating: number,
): Promise<{ ok: boolean }> =>
    request(`/mem/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ rating }),
    });

export const previewMem = (
    id: number,
): Promise<{ intervals: readonly number[] }> =>
    request(`/mem/${id}/preview`, {});

export const deleteMem = (
    id: number,
): Promise<{ ok: boolean }> =>
    request(`/mem/${id}`, { method: "DELETE" });

export const buryMem = (
    id: number,
): Promise<{ ok: boolean }> =>
    request(`/mem/${id}/bury`, { method: "POST" });

export const unburyMem = (
    id: number,
): Promise<{ ok: boolean }> =>
    request(`/mem/${id}/unbury`, { method: "POST" });

export const editMem = (
    id: number,
    cue: string,
    target: string,
): Promise<{ ok: boolean }> =>
    request(`/mem/${id}/edit`, {
        method: "PUT",
        body: JSON.stringify({ cue_content: cue, target_content: target }),
    });

export const uploadImage = async (file: File): Promise<string | null> => {
    const form = new FormData();
    form.append("file", file);
    try {
        const res = await fetch("/api/images/upload", {
            method: "POST",
            headers: { Authorization: `Bearer ${getToken()}` },
            body: form,
        });
        const json = await res.json();
        return json.url ?? null;
    } catch {
        return null;
    }
};
