import { type Effect, Schema } from "effect";
import { request } from "./request.ts";
import type { ApiErrorType } from "./types/index.ts";

const ChunkSchema = Schema.Struct({
    id: Schema.Number,
    content: Schema.String,
});

const MemWithChunksSchema = Schema.Struct({
    id: Schema.Number,
    cue: ChunkSchema,
    target: ChunkSchema,
    state: Schema.String,
    stability: Schema.Number,
    difficulty: Schema.Number,
    due_at: Schema.String,
});

const DueResponseSchema = Schema.Struct({
    items: Schema.Array(MemWithChunksSchema),
    due_count: Schema.Number,
    has_more: Schema.Boolean,
    upcoming_count: Schema.Number,
    all_far: Schema.Boolean,
});

const OkSchema = Schema.Struct({ ok: Schema.Boolean });

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
): Effect.Effect<{ id: number }, ApiErrorType> =>
    request("/mem", Schema.Struct({ id: Schema.Number }), {
        method: "POST",
        body: JSON.stringify({
            cue_content: cueMd,
            target_content: targetMd,
            prerequisites,
        }),
    });

export const getAllMems = (
    pageSize = 200,
): Effect.Effect<DueResponse, ApiErrorType> =>
    request(`/mem/all?page_size=${pageSize}`, DueResponseSchema, {});

export const getDue = (
    limit = 50,
): Effect.Effect<DueResponse, ApiErrorType> =>
    request(`/mem/due?limit=${limit}`, DueResponseSchema, {});

export const reviewMem = (
    id: number,
    rating: number,
): Effect.Effect<{ ok: boolean }, ApiErrorType> =>
    request(`/mem/${id}/review`, OkSchema, {
        method: "POST",
        body: JSON.stringify({ rating }),
    });

export const previewMem = (
    id: number,
): Effect.Effect<{ intervals: readonly number[] }, ApiErrorType> =>
    request(`/mem/${id}/preview`, Schema.Struct({ intervals: Schema.Array(Schema.Number) }), {});

export const deleteMem = (
    id: number,
): Effect.Effect<{ ok: boolean }, ApiErrorType> =>
    request(`/mem/${id}`, OkSchema, { method: "DELETE" });

export const buryMem = (
    id: number,
): Effect.Effect<{ ok: boolean }, ApiErrorType> =>
    request(`/mem/${id}/bury`, OkSchema, { method: "POST" });

export const unburyMem = (
    id: number,
): Effect.Effect<{ ok: boolean }, ApiErrorType> =>
    request(`/mem/${id}/unbury`, OkSchema, { method: "POST" });

export const editMem = (
    id: number,
    cue: string,
    target: string,
): Effect.Effect<{ ok: boolean }, ApiErrorType> =>
    request(`/mem/${id}/edit`, OkSchema, {
        method: "PUT",
        body: JSON.stringify({ cue_content: cue, target_content: target }),
    });

const ImageUploadSchema = Schema.Struct({
    url: Schema.String,
});

export const uploadImage = (
    file: File,
): Effect.Effect<{ url: string }, ApiErrorType> => {
    const form = new FormData();
    form.append("file", file);
    return request("/images/upload", ImageUploadSchema, { method: "POST", body: form });
};
