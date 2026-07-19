import { request } from "./request.ts";
import { CACHE, cachedRequest, tapInvalidate } from "./cache.ts";

export interface Sign {
	readonly id: number;
	readonly signifier: string;
	readonly signified: string;
	readonly onto_id: number | null;
	readonly weight: number | null;
	readonly relation_type: string | null;
	readonly created_at: string;
}

/** 符号关系不常变，缓存 60 秒 */
export const getSignsE = (): Promise<readonly Sign[]> =>
	cachedRequest<{ readonly items: readonly Sign[] }>("/sign", {}, 60_000).then(
		(r) => r.items,
	);

export const getSignE = (id: number): Promise<Sign> =>
	cachedRequest<Sign>(`/sign/${id}`, {}, 60_000);

export const createSignE = (data: {
	signifier: string;
	signified: string;
	onto_id?: number | null;
	weight?: number | null;
	relation_type?: string | null;
}): Promise<Sign> =>
	request<Sign>("/sign", {
		method: "POST",
		body: JSON.stringify(data),
	}).then((r) => tapInvalidate(CACHE.sign, r));

export const deleteSignE = (id: number): Promise<void> =>
	request<void>(`/sign/${id}`, {
		method: "DELETE",
	}).then((r) => tapInvalidate(CACHE.sign, r));

/** 按能指查询（缓存 60 秒）。 */
export const getSignsBySignifierE = (
	signifier: string,
): Promise<readonly Sign[]> =>
	cachedRequest<{ readonly items: readonly Sign[] }>(
		`/sign/signifier/${encodeURIComponent(signifier)}`,
		{},
		60_000,
	).then((r) => r.items);

/** 按所指查询（缓存 60 秒）。 */
export const getSignsBySignifiedE = (
	signified: string,
): Promise<readonly Sign[]> =>
	cachedRequest<{ readonly items: readonly Sign[] }>(
		`/sign/signified/${encodeURIComponent(signified)}`,
		{},
		60_000,
	).then((r) => r.items);
