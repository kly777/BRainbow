import { type Effect, Schema } from "effect";
import { request } from "./request.ts";
import type { ApiErrorType } from "./types/index.ts";

const TabItemSchema = Schema.Struct({
    name: Schema.String,
    content: Schema.String,
});

const TextResponseSchema = Schema.Struct({
    tabs: Schema.Array(TabItemSchema),
});

export interface TabItem {
    readonly name: string;
    readonly content: string;
}

export interface TextResponse {
    readonly tabs: readonly TabItem[];
}

export const loadText = (): Effect.Effect<TextResponse, ApiErrorType> =>
    request("/text", TextResponseSchema, {});

export const saveText = (
    tabs: readonly { name: string; content: string }[],
): Effect.Effect<{ readonly ok: boolean }, ApiErrorType> =>
    request("/text", Schema.Struct({ ok: Schema.Boolean }), {
        method: "PUT",
        body: JSON.stringify({ tabs }),
    });
