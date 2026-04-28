import { type Effect, Schema } from "effect";
import { request } from "./request";
import {
	type ApiErrorType,
	type Card,
	CardSchema,
	type CreateCardRequest,
	type UpdateCardRequest,
} from "./types";

// ==================== Card API Functions ====================

export const getCards = (): Effect.Effect<readonly Card[], ApiErrorType> =>
	request("/card", Schema.Array(CardSchema), {});

export const getCard = (id: number): Effect.Effect<Card, ApiErrorType> =>
	request(`/card/${id}`, CardSchema, {});

export const createCard = (
	card: CreateCardRequest,
): Effect.Effect<Card, ApiErrorType> =>
	request("/card", CardSchema, {
		method: "POST",
		body: JSON.stringify(card),
	});

export const updateCard = (
	id: number,
	card: UpdateCardRequest,
): Effect.Effect<Card, ApiErrorType> =>
	request(`/card/${id}`, CardSchema, {
		method: "PATCH",
		body: JSON.stringify(card),
	});

export const deleteCard = (id: number): Effect.Effect<void, ApiErrorType> =>
	request(`/card/${id}`, Schema.Void, {
		method: "DELETE",
	});
