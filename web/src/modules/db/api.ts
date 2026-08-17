import {
	API_BASE_URL,
	cachedRequest,
	extractErrorBody,
	getApiKey,
	getToken,
	HttpError,
	handleGlobalError,
	type PaginationParams,
} from "@lib/api";

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

export interface TableQueryParams {
	id?: number;
	ref_col?: string;
	sort?: string;
	order?: "asc" | "desc";
	fcol?: string;
	q?: string;
}

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
	if (params?.fcol) query.set("fcol", params.fcol);
	if (params?.q) query.set("q", params.q);
	return cachedRequest(`/db/${name}?${query.toString()}`, {});
};

const downloadBlob = (blob: Blob, filename: string): void => {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
};

const filenameFromDisposition = (
	disposition: string | null,
	fallback: string,
): string => {
	const match = disposition?.match(/filename="([^"]+)"/i);
	return match?.[1] ?? fallback;
};

/**
 * 下载当前筛选 + 排序下的全部匹配行（后端限制最多 10000 行）。
 * 使用原生 fetch：request() 只解析 JSON，无法拿到文件流。
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
	if (params.fcol) query.set("fcol", params.fcol);
	if (params.q) query.set("q", params.q);

	const headers = new Headers();
	const token = getToken();
	const apiKey = getApiKey();
	if (token) headers.set("Authorization", `Bearer ${token}`);
	if (apiKey) headers.set("X-API-Key", apiKey);

	const endpoint = `/db/${encodeURIComponent(name)}/export?${query.toString()}`;
	const response = await fetch(`${API_BASE_URL}${endpoint}`, { headers });
	if (!response.ok) {
		const errorBody = await extractErrorBody(response);
		const httpError = new HttpError({
			status: response.status,
			code: errorBody.code,
			message: errorBody.message,
			details: errorBody.details,
		});
		await handleGlobalError(endpoint, httpError);
		throw httpError;
	}
	const blob = await response.blob();
	downloadBlob(
		blob,
		filenameFromDisposition(
			response.headers.get("content-disposition"),
			`${name}.${params.format}`,
		),
	);
};
