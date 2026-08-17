import type { PaginationParams } from "@lib/api";
import { cachedRequest } from "@lib/api";

export const getTablesE = (): Promise<readonly string[]> =>
	cachedRequest("/db", {});

export interface ColumnInfo {
	readonly name: string;
	readonly col_type: string;
	/** 跳转目标表（外键列，由后端识别） */
	readonly ref_table?: string | null;
	/** 目标表中被引用的列 */
	readonly ref_column?: string | null;
}

export interface RefPreview {
	readonly table: string;
	readonly id: number;
	readonly summary: string;
}

export interface TableData {
	readonly header: readonly ColumnInfo[];
	readonly rows: readonly (readonly (string | number | null)[])[];
	readonly total: number;
	/** 外键单元格的目标行摘要 */
	readonly refs: readonly RefPreview[];
}

export const getTableDataE = (
	name: string,
	params?: PaginationParams & {
		id?: number;
		ref_col?: string;
		sort?: string;
		order?: "asc" | "desc";
		fcol?: string;
		q?: string;
	},
): Promise<TableData> => {
	const page = params?.page ?? 1;
	const pageSize = params?.page_size ?? 50;
	const query = new URLSearchParams();
	query.set("page", String(page));
	query.set("page_size", String(pageSize));
	if (params?.id) query.set("id", String(params.id));
	if (params?.ref_col) query.set("ref_col", params.ref_col);
	if (params?.sort) query.set("sort", params.sort);
	if (params?.order) query.set("order", params.order);
	if (params?.fcol) query.set("fcol", params.fcol);
	if (params?.q) query.set("q", params.q);
	return cachedRequest(`/db/${name}?${query.toString()}`, {});
};
