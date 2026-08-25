import {
	CACHE,
	cachedRequest,
	del,
	type PaginatedResponse,
	post,
	request,
	withInvalidate,
} from "@lib/api";
import type { Card, CreateCardRequest, UpdateCardRequest } from "./model.ts";

// ==================== Card API Functions ====================

export const getCardsE = (
	page = 1,
	pageSize = 20,
): Promise<PaginatedResponse<Card>> =>
	cachedRequest(`/cards?page=${page}&page_size=${pageSize}`, {});

// 单张卡片缓存 60 秒，不常变
export const getCardE = (id: number): Promise<Card> =>
	cachedRequest(`/cards/${id}`, {}, 60_000);

export const createCardE = (card: CreateCardRequest): Promise<Card> =>
	withInvalidate(CACHE.cards, post<Card>("/cards", card));

export const updateCardE = (
	id: number,
	card: UpdateCardRequest,
): Promise<Card> =>
	withInvalidate(
		CACHE.cards,
		request<Card>(`/cards/${id}`, {
			method: "PATCH",
			body: JSON.stringify(card),
		}),
	);

export const deleteCardE = (id: number): Promise<void> =>
	withInvalidate(CACHE.cards, del<void>(`/cards/${id}`));

export const searchCardsE = (
	query: string,
	page = 1,
	pageSize = 20,
): Promise<PaginatedResponse<Card>> =>
	cachedRequest(
		`/cards/search?q=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`,
		{},
	);
