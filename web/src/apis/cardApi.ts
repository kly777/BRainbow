import { request } from "./request.ts";
import { type Card, type CreateCardRequest, type UpdateCardRequest } from "./types/index.ts";

// ==================== Card API Functions ====================

export const getCardsE = () => request("/cards", {});

export const getCardE = (id: number): Promise<Card> =>
    request(`/cards/${id}`, {});

export const createCardE = (
    card: CreateCardRequest,
): Promise<Card> =>
    request("/cards", {
        method: "POST",
        body: JSON.stringify(card),
    });

export const updateCardE = (
    id: number,
    card: UpdateCardRequest,
): Promise<Card> =>
    request(`/cards/${id}`, {
        method: "PATCH",
        body: JSON.stringify(card),
    });

export const deleteCardE = (id: number): Promise<void> =>
    request(`/cards/${id}`, {
        method: "DELETE",
    });

export const searchCardsE = (
    query: string,
) => request(
    `/cards/search?q=${encodeURIComponent(query)}`,
    {},
);
