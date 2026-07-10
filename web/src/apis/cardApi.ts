import { CACHE, cachedRequest, request, tapInvalidate } from "./request.ts";
import type {
	Card,
	CreateCardRequest,
	UpdateCardRequest,
} from "./types/index.ts";

// ==================== 类型 ====================

export interface PaginatedCards {
	items: Card[];
	total: number;
	page: number;
	page_size: number;
	total_pages: number;
}

// ==================== Card API Functions ====================

export const getCardsE = (): Promise<PaginatedCards> =>
	cachedRequest("/cards", {});

// 单张卡片缓存 60 秒，不常变
export const getCardE = (id: number): Promise<Card> =>
	cachedRequest(`/cards/${id}`, {}, 60_000);

export const createCardE = (card: CreateCardRequest): Promise<Card> =>
	request<Card>("/cards", {
		method: "POST",
		body: JSON.stringify(card),
	}).then((r) => tapInvalidate(CACHE.cards, r));

export const updateCardE = (
	id: number,
	card: UpdateCardRequest,
): Promise<Card> =>
	request<Card>(`/cards/${id}`, {
		method: "PATCH",
		body: JSON.stringify(card),
	}).then((r) => tapInvalidate(CACHE.cards, r));

export const deleteCardE = (id: number): Promise<void> =>
	request<void>(`/cards/${id}`, {
		method: "DELETE",
	}).then((r) => tapInvalidate(CACHE.cards, r));

export const searchCardsE = (query: string): Promise<PaginatedCards> =>
	cachedRequest(`/cards/search?q=${encodeURIComponent(query)}`, {});
