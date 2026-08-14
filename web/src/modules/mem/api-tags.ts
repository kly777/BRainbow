// ── 标签 API ──

import { CACHE, del, post, request, tapInvalidate } from "@lib/api";
import type { BatchDataResponse, BatchResponse } from "./api-types.ts";

// ── 标签 ──

export interface TagInfo {
	id: number;
	name: string;
	created_at: string;
}

export interface TagMemRequest {
	mem_id: number;
	tag_id: number;
}

export interface SetTagsRequest {
	mem_id: number;
	tag_ids: number[];
}

export const createTagE = (name: string): Promise<TagInfo> =>
	post<TagInfo>("/mem/tag/create", { name });

export const deleteTagE = (id: number): Promise<{ ok: boolean }> =>
	del<{ ok: boolean }>(`/mem/tag/delete/${id}`);

export const listTagsE = (): Promise<TagInfo[]> =>
	request<TagInfo[]>("/mem/tag/list", {});

export const searchTagsE = (q: string): Promise<TagInfo[]> =>
	request<TagInfo[]>(`/mem/tag/search?q=${encodeURIComponent(q)}`, {});

export const getMemTagsE = (memId: number): Promise<TagInfo[]> =>
	request<TagInfo[]>(`/mem/tag/mem/${memId}`, {});

export const addTagToMemE = (
	memId: number,
	tagId: number,
): Promise<{ ok: boolean }> =>
	post<{ ok: boolean }>("/mem/tag/mem/add", {
		mem_id: memId,
		tag_id: tagId,
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const removeTagFromMemE = (
	memId: number,
	tagId: number,
): Promise<{ ok: boolean }> =>
	post<{ ok: boolean }>("/mem/tag/mem/remove", {
		mem_id: memId,
		tag_id: tagId,
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const setMemTagsE = (
	memId: number,
	tagIds: number[],
): Promise<{ ok: boolean }> =>
	post<{ ok: boolean }>("/mem/tag/mem/set", {
		mem_id: memId,
		tag_ids: tagIds,
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const batchAddTagToMemsE = (
	memIds: number[],
	tagId: number,
): Promise<BatchResponse> =>
	post<BatchResponse>("/mem/tag/batch-add", {
		items: memIds,
		tag_id: tagId,
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const batchRemoveTagFromMemsE = (
	memIds: number[],
	tagId: number,
): Promise<BatchResponse> =>
	post<BatchResponse>("/mem/tag/batch-remove", {
		items: memIds,
		tag_id: tagId,
	}).then((r) => tapInvalidate(CACHE.mem, r));

export interface MemTagRow {
	mem_id: number;
	id: number;
	name: string;
	created_at: string;
}

export const batchGetMemsTagsE = (
	memIds: number[],
): Promise<BatchDataResponse<MemTagRow>> =>
	request<BatchDataResponse<MemTagRow>>("/mem/tag/batch-by-ids", {
		method: "POST",
		body: JSON.stringify({ items: memIds }),
	});

export const batchSetTagsForMemsE = (
	memIds: number[],
	tagIds: number[],
): Promise<BatchResponse> =>
	post<BatchResponse>("/mem/tag/batch-set", {
		items: memIds,
		tag_ids: tagIds,
	}).then((r) => tapInvalidate(CACHE.mem, r));
