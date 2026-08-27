import {
	cachedRequest,
	del,
	domains,
	type PaginatedResponse,
	post,
	request,
} from "@shared/api";

import type { Card, CreateCardRequest, UpdateCardRequest } from "./model.ts";

// ==================== Card API Functions ====================

export const getCardsE = (
	page = 1,
	pageSize = 20,
): Promise<PaginatedResponse<Card>> =>
	cachedRequest(`/cards?page=${page}&page_size=${pageSize}`);

// 单张卡片缓存 60 秒，不常变
export const getCardE = (id: number): Promise<Card> =>
	cachedRequest(`/cards/${id}`);

export const createCardE = (card: CreateCardRequest): Promise<Card> =>
	domains.cards.invalidate(post<Card>("/cards", card));

export const updateCardE = (
	id: number,
	card: UpdateCardRequest,
): Promise<Card> =>
	domains.cards.invalidate(
		request<Card>(`/cards/${id}`, {
			method: "PATCH",
			body: JSON.stringify(card),
		}),
		{ entity: `/cards/${id}` },
	);

export const deleteCardE = (id: number): Promise<void> =>
	domains.cards.invalidate(del<void>(`/cards/${id}`), {
		entity: `/cards/${id}`,
	});

export const searchCardsE = (
	query: string,
	page = 1,
	pageSize = 20,
): Promise<PaginatedResponse<Card>> =>
	cachedRequest(
		`/cards/search?q=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`,
	);
