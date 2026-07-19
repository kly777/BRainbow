import { del, post, request } from "../../apis/request.ts";
import { CACHE, cachedRequest, tapInvalidate } from "../../apis/cache.ts";
import type { Card, CreateCardRequest, UpdateCardRequest } from "./types.ts";

// ==================== 类型 ====================

export interface PaginatedCards {
	items: Card[];
	total: number;
	page: number;
	page_size: number;
	total_pages: number;
}

// ==================== Card API Functions ====================

export const getCardsE = (page = 1, pageSize = 20): Promise<PaginatedCards> =>
	cachedRequest(`/cards?page=${page}&page_size=${pageSize}`, {});

// 单张卡片缓存 60 秒，不常变
export const getCardE = (id: number): Promise<Card> =>
	cachedRequest(`/cards/${id}`, {}, 60_000);

export const createCardE = (card: CreateCardRequest): Promise<Card> =>
	post<Card>("/cards", card).then((r) => tapInvalidate(CACHE.cards, r));

export const updateCardE = (
	id: number,
	card: UpdateCardRequest,
): Promise<Card> =>
	request<Card>(`/cards/${id}`, {
		method: "PATCH",
		body: JSON.stringify(card),
	}).then((r) => tapInvalidate(CACHE.cards, r));

export const deleteCardE = (id: number): Promise<void> =>
	del<void>(`/cards/${id}`).then((r) => tapInvalidate(CACHE.cards, r));

export const searchCardsE = (
	query: string,
	page = 1,
	pageSize = 20,
): Promise<PaginatedCards> =>
	cachedRequest(
		`/cards/search?q=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`,
		{},
	);
