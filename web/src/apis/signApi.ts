import { type Effect, Schema } from "effect";
import { request } from "./request";
import type { ApiErrorType } from "./types";

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

export const getSigns = (): Effect.Effect<readonly Sign[], ApiErrorType> =>
	request("/sign", Schema.Array(SignSchema), {});

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

export const getSignsBySignifier = (
	signifier: string,
): Effect.Effect<readonly Sign[], ApiErrorType> =>
	request(
		`/sign/signifier/${encodeURIComponent(signifier)}`,
		Schema.Array(SignSchema),
		{},
	);

export const getSignsBySignified = (
	signified: string,
): Effect.Effect<readonly Sign[], ApiErrorType> =>
	request(
		`/sign/signified/${encodeURIComponent(signified)}`,
		Schema.Array(SignSchema),
		{},
	);
