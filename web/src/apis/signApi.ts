import { Effect, Schema } from "effect";
import { request } from "./request.ts";
import { type ApiErrorType, PaginatedSchema } from "./types/index.ts";

export const SignSchema = Schema.Struct({
    id: Schema.Number,
    signifier: Schema.String,
    signified: Schema.String,
    onto_id: Schema.NullOr(Schema.Number),
    weight: Schema.NullOr(Schema.Number),
    relation_type: Schema.NullOr(Schema.String),
    created_at: Schema.String,
});

export type Sign = Schema.Schema.Type<typeof SignSchema>;

/** 获取所有符号关系（后端返回分页结构，自动提取 items）。 */
export const getSigns = (): Effect.Effect<readonly Sign[], ApiErrorType> =>
    request("/sign", PaginatedSchema(SignSchema), {}).pipe(
        Effect.map((r) => r.items),
    );

export const getSign = (id: number): Effect.Effect<Sign, ApiErrorType> =>
    request(`/sign/${id}`, SignSchema, {});

export const createSign = (data: {
    signifier: string;
    signified: string;
    onto_id?: number | null;
    weight?: number | null;
    relation_type?: string | null;
}): Effect.Effect<Sign, ApiErrorType> =>
    request("/sign", SignSchema, {
        method: "POST",
        body: JSON.stringify(data),
    });

export const deleteSign = (id: number): Effect.Effect<void, ApiErrorType> =>
    request(`/sign/${id}`, Schema.Void, {
        method: "DELETE",
    });

/** 按能指查询（后端返回分页结构，自动提取 items）。 */
export const getSignsBySignifier = (
    signifier: string,
): Effect.Effect<readonly Sign[], ApiErrorType> =>
    request(
        `/sign/signifier/${encodeURIComponent(signifier)}`,
        PaginatedSchema(SignSchema),
        {},
    ).pipe(Effect.map((r) => r.items));

/** 按所指查询（后端返回分页结构，自动提取 items）。 */
export const getSignsBySignified = (
    signified: string,
): Effect.Effect<readonly Sign[], ApiErrorType> =>
    request(
        `/sign/signified/${encodeURIComponent(signified)}`,
        PaginatedSchema(SignSchema),
        {},
    ).pipe(Effect.map((r) => r.items));
