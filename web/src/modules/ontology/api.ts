import {
	CACHE,
	cachedRequest,
	patch,
	post,
	request,
	withInvalidate,
} from "@shared/api";

export interface Onto {
	readonly id: number;
	readonly name: string;
	readonly description: string | null;
}

/**
 * 获取所有本体（后端返回分页结构，自动提取 items）。
 */
// 本体数据不常变，缓存 60 秒
export const getOntosE = (): Promise<readonly Onto[]> =>
	cachedRequest<{ readonly items: readonly Onto[] }>("/onto", {}, 60_000).then(
		(r) => r.items,
	);

export const getOntoE = (id: number): Promise<Onto> =>
	cachedRequest<Onto>(`/onto/${id}`, {}, 60_000);

export const createOntoE = (
	name: string,
	description?: string,
): Promise<Onto> =>
	withInvalidate(CACHE.onto, post<Onto>("/onto", { name, description }));

export const updateOntoE = (
	id: number,
	data: { name?: string; description?: string },
): Promise<Onto> =>
	withInvalidate(CACHE.onto, patch<Onto>(`/onto/${id}`, data));

export const deleteOntoE = (id: number): Promise<void> =>
	withInvalidate(
		CACHE.onto,
		request<void>(`/onto/${id}`, {
			method: "DELETE",
		}),
	);
