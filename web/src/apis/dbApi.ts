import { request } from "./request.ts";
import type { PaginationParams } from "./types/index.ts";

export const getTablesE = (): Promise<readonly string[]> =>
    request("/db", {});

export interface ColumnInfo {
    readonly name: string;
    readonly col_type: string;
}

export interface TableData {
    readonly header: readonly ColumnInfo[];
    readonly rows: readonly (readonly (string | number | null)[])[];
}

export const getTableDataE = (
    name: string,
    params?: PaginationParams,
): Promise<TableData> => {
    const page = params?.page ?? 1;
    const pageSize = params?.page_size ?? 20;
    return request(`/db/${name}?page=${page}&page_size=${pageSize}`, {});
};
