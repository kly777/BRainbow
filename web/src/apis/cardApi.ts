import { type Effect, Schema } from "effect";
import { request, runApiEffect } from "./request";
import {
	type ApiErrorType,
	type Card,
	CardSchema,
	type CreateCardRequest,
	type UpdateCardRequest,
} from "./types";

// ==================== Card API Functions ====================

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
		method: "PUT",
		body: JSON.stringify(card),
	});

export const deleteCard = (id: number): Effect.Effect<void, ApiErrorType> =>
	request(`/card/${id}`, Schema.Void, {
		method: "DELETE",
	});

// ==================== CardApi Class ====================

export class CardApiClient {
	// Card operations
	async getCards(): Promise<Card[]> {
		const result = await runApiEffect(getCards());
		return [...result]; // Convert readonly to mutable
	}

	async getCard(id: number): Promise<Card> {
		return runApiEffect(getCard(id));
	}

	async createCard(card: CreateCardRequest): Promise<Card> {
		return runApiEffect(createCard(card));
	}

	async updateCard(id: number, card: UpdateCardRequest): Promise<Card> {
		return runApiEffect(updateCard(id, card));
	}

	async deleteCard(id: number): Promise<void> {
		return runApiEffect(deleteCard(id));
	}
}

// Export default instance
export const cardApi = new CardApiClient();
