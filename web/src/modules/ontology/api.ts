import { cachedRequest, patch, post, request, resource } from "@shared/api";

const onto = resource("onto");

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
): Promise<Onto> => onto.invalidate(post<Onto>("/onto", { name, description }));

export const updateOntoE = (
	id: number,
	data: { name?: string; description?: string },
): Promise<Onto> => onto.invalidate(patch<Onto>(`/onto/${id}`, data));

export const deleteOntoE = (id: number): Promise<void> =>
	onto.invalidate(
		request<void>(`/onto/${id}`, {
			method: "DELETE",
		}),
	);
