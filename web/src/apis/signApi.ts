import { request } from "./request.ts";

export interface Sign {
	readonly id: number;
	readonly signifier: string;
	readonly signified: string;
	readonly onto_id: number | null;
	readonly weight: number | null;
	readonly relation_type: string | null;
	readonly created_at: string;
}

/** 获取所有符号关系（后端返回分页结构，自动提取 items）。 */
export const getSignsE = (): Promise<readonly Sign[]> =>
	request<{ readonly items: readonly Sign[] }>("/sign", {}).then(
		(r) => r.items,
	);

export const getSignE = (id: number): Promise<Sign> =>
	request<Sign>(`/sign/${id}`, {});

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
	});

export const deleteSignE = (id: number): Promise<void> =>
	request<void>(`/sign/${id}`, {
		method: "DELETE",
	});

/** 按能指查询（后端返回分页结构，自动提取 items）。 */
export const getSignsBySignifierE = (
	signifier: string,
): Promise<readonly Sign[]> =>
	request<{ readonly items: readonly Sign[] }>(
		`/sign/signifier/${encodeURIComponent(signifier)}`,
		{},
	).then((r) => r.items);

/** 按所指查询（后端返回分页结构，自动提取 items）。 */
export const getSignsBySignifiedE = (
	signified: string,
): Promise<readonly Sign[]> =>
	request<{ readonly items: readonly Sign[] }>(
		`/sign/signified/${encodeURIComponent(signified)}`,
		{},
	).then((r) => r.items);
