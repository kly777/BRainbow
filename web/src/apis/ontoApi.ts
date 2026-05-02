import { type Effect, Schema } from "effect";
import { request } from "./request";
import type { ApiErrorType } from "./types";

export const OntoSchema = Schema.Struct({
	id: Schema.Number,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
});

export interface Onto extends Schema.Schema.Type<typeof OntoSchema> {}

export const getOntos = (): Effect.Effect<readonly Onto[], ApiErrorType> =>
	request("/onto", Schema.Array(OntoSchema), {});

export const getOnto = (id: number): Effect.Effect<Onto, ApiErrorType> =>
	request(`/onto/${id}`, OntoSchema, {});

export const createOnto = (
	name: string,
	description?: string,
): Effect.Effect<Onto, ApiErrorType> =>
	request("/onto", OntoSchema, {
		method: "POST",
		body: JSON.stringify({ name, description }),
	});

export const updateOnto = (
	id: number,
	data: { name?: string; description?: string },
): Effect.Effect<Onto, ApiErrorType> =>
	request(`/onto/${id}`, OntoSchema, {
		method: "PATCH",
		body: JSON.stringify(data),
	});

export const deleteOnto = (id: number): Effect.Effect<void, ApiErrorType> =>
	request(`/onto/${id}`, Schema.Void, {
		method: "DELETE",
	});
