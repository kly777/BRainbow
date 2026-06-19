import { request } from "./request.ts";
import type { Card, CreateCardRequest, UpdateCardRequest } from "./types/index.ts";

// ==================== 类型 ====================

export interface PaginatedCards {
    items: Card[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
}

// ==================== Card API Functions ====================

export const getCardsE = (): Promise<PaginatedCards> => request("/cards", {});

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
): Promise<PaginatedCards> => request(
    `/cards/search?q=${encodeURIComponent(query)}`,
    {},
);
