import {
	cachedRequest,
	del,
	type PaginatedResponse,
	post,
	request,
	resource,
} from "@shared/api";

const cards = resource("cards");

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
	cards.invalidate(post<Card>("/cards", card));

export const updateCardE = (
	id: number,
	card: UpdateCardRequest,
): Promise<Card> =>
	cards.invalidate(
		request<Card>(`/cards/${id}`, {
			method: "PATCH",
			body: JSON.stringify(card),
		}),
	);

export const deleteCardE = (id: number): Promise<void> =>
	cards.invalidate(del<void>(`/cards/${id}`));

export const searchCardsE = (
	query: string,
	page = 1,
	pageSize = 20,
): Promise<PaginatedResponse<Card>> =>
	cachedRequest(
		`/cards/search?q=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`,
		{},
	);
