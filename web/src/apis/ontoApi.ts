import { request } from "./request.ts";

export interface Onto {
	readonly id: number;
	readonly name: string;
	readonly description: string | null;
}

/**
 * 获取所有本体（后端返回分页结构，自动提取 items）。
 */
export const getOntosE = (): Promise<readonly Onto[]> =>
	request<{ readonly items: readonly Onto[] }>("/onto", {}).then(
		(r) => r.items,
	);

export const getOntoE = (id: number): Promise<Onto> =>
	request<Onto>(`/onto/${id}`, {});

export const createOntoE = (
	name: string,
	description?: string,
): Promise<Onto> =>
	request<Onto>("/onto", {
		method: "POST",
		body: JSON.stringify({ name, description }),
	});

export const updateOntoE = (
	id: number,
	data: { name?: string; description?: string },
): Promise<Onto> =>
	request<Onto>(`/onto/${id}`, {
		method: "PATCH",
		body: JSON.stringify(data),
	});

export const deleteOntoE = (id: number): Promise<void> =>
	request<void>(`/onto/${id}`, {
		method: "DELETE",
	});
