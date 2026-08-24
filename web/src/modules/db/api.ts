import { cachedRequest, type PaginationParams, requestFile } from "@lib/api";
import { downloadBlob } from "@lib/utils";

export const getTablesE = (): Promise<readonly string[]> =>
	cachedRequest("/db", {});

export interface ColumnInfo {
	readonly name: string;
	readonly col_type: string;
	/** 是否主键（复合主键时为第一个组件） */
	readonly is_primary: boolean;
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

export interface BackRefRow {
	readonly key: number;
	readonly summary: string;
}

export interface BackRefGroup {
	readonly source_table: string;
	readonly column: string;
	readonly total: number;
	readonly rows: readonly BackRefRow[];
}

export type FilterOpValue =
	| "eq"
	| "ne"
	| "contains"
	| "prefix"
	| "null"
	| "notnull"
	| "gt"
	| "lt";

export interface TableQueryParams {
	id?: number;
	ref_col?: string;
	sort?: string;
	order?: "asc" | "desc";
	/** 多条件筛选列（可重复，与 fop/fval 对齐） */
	fcol?: readonly string[];
	/** 多条件筛选操作符（可重复） */
	fop?: readonly FilterOpValue[];
	/** 多条件筛选值（可重复） */
	fval?: readonly string[];
}

const appendFilters = (
	query: URLSearchParams,
	params: TableQueryParams | undefined,
): void => {
	params?.fcol?.forEach((col, index) => {
		query.append("fcol", col);
		query.append("fop", params.fop?.[index] ?? "contains");
		query.append("fval", params.fval?.[index] ?? "");
	});
};

export const getTableDataE = (
	name: string,
	params?: PaginationParams & TableQueryParams,
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
	appendFilters(query, params);
	return cachedRequest(`/db/${name}?${query.toString()}`, {});
};

/** 查询其他表对当前表某行（主键 id）的反向引用。 */
export const getBackRefsE = (
	name: string,
	id: number,
): Promise<readonly BackRefGroup[]> =>
	cachedRequest(`/db/${encodeURIComponent(name)}/backrefs?id=${id}`, {});

const filenameFromDisposition = (
	disposition: string | null,
	fallback: string,
): string => {
	const match = disposition?.match(/filename="([^"]+)"/i);
	return match?.[1] ?? fallback;
};

/**
 * 下载当前筛选 + 排序下的全部匹配行（后端限制最多 10000 行）。
 * 走 requestFile：request() 只解析 JSON，无法拿到文件流。
 */
export const downloadTableExport = async (
	name: string,
	params: TableQueryParams & { format: "csv" | "json" },
): Promise<void> => {
	const query = new URLSearchParams();
	query.set("format", params.format);
	if (params.id) query.set("id", String(params.id));
	if (params.ref_col) query.set("ref_col", params.ref_col);
	if (params.sort) query.set("sort", params.sort);
	if (params.order) query.set("order", params.order);
	appendFilters(query, params);

	const endpoint = `/db/${encodeURIComponent(name)}/export?${query.toString()}`;
	const response = await requestFile(endpoint);
	downloadBlob(
		await response.blob(),
		filenameFromDisposition(
			response.headers.get("content-disposition"),
			`${name}.${params.format}`,
		),
	);
};
