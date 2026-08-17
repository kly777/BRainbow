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

export interface TableData {
	readonly header: readonly ColumnInfo[];
	readonly rows: readonly (readonly (string | number | null)[])[];
	readonly total: number;
}

export const getTableDataE = (
	name: string,
	params?: PaginationParams & { id?: number; ref_col?: string },
): Promise<TableData> => {
	const page = params?.page ?? 1;
	const pageSize = params?.page_size ?? 50;
	const id = params?.id;
	const refCol = params?.ref_col;
	return cachedRequest(
		`/db/${name}?page=${page}&page_size=${pageSize}${id ? `&id=${id}` : ""}${refCol ? `&ref_col=${encodeURIComponent(refCol)}` : ""}`,
		{},
	);
};
