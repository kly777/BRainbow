import type { PaginationParams } from "@lib/api";
import { cachedRequest } from "@lib/api";

export const getTablesE = (): Promise<readonly string[]> =>
	cachedRequest("/db", {});

export interface ColumnInfo {
	readonly name: string;
	readonly col_type: string;
}

export interface TableData {
	readonly header: readonly ColumnInfo[];
	readonly rows: readonly (readonly (string | number | null)[])[];
	readonly total: number;
}

export const getTableDataE = (
	name: string,
	params?: PaginationParams,
): Promise<TableData> => {
	const page = params?.page ?? 1;
	const pageSize = params?.page_size ?? 50;
	return cachedRequest(`/db/${name}?page=${page}&page_size=${pageSize}`, {});
};
