import { type Effect, Schema } from "effect";
import { request } from "./request.ts";
import type { ApiErrorType } from "./types/index.ts";

const ChunkPartSchema = Schema.Union(
    Schema.Struct({ type: Schema.Literal("text"), content: Schema.String }),
    Schema.Struct({ type: Schema.Literal("image"), url: Schema.String }),
    Schema.Struct({ type: Schema.Literal("audio"), url: Schema.String }),
);

const ChunkSchema = Schema.Struct({
    id: Schema.Number,
    parts: Schema.Array(ChunkPartSchema),
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
});

const OkSchema = Schema.Struct({ ok: Schema.Boolean });

// ── 类型 ──

export interface ChunkPart {
    type: "text" | "image" | "audio";
    content?: string;
    url?: string;
}

export interface MemItem {
    id: number;
    cue: { id: number; parts: ChunkPart[] };
    target: { id: number; parts: ChunkPart[] };
    state: string;
    stability: number;
    difficulty: number;
    due_at: string;
}

export interface DueResponse {
    items: MemItem[];
    due_count: number;
}

// ── API ──

export const createMem = (
    cueParts: ChunkPart[],
    targetParts: ChunkPart[],
    prerequisites: number[],
): Effect.Effect<{ id: number }, ApiErrorType> =>
    request("/mem", Schema.Struct({ id: Schema.Number }), {
        method: "POST",
        body: JSON.stringify({
            cue_parts: cueParts,
            target_parts: targetParts,
            prerequisites,
        }),
    });

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
