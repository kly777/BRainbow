// ── 通用分页 ──

export interface PaginatedResponse<T> {
	items: T[];
	total: number;
	page: number;
	page_size: number;
	total_pages: number;
}

export interface PaginationParams {
	/** 页码，从 1 开始，默认 1 */
	page?: number;
	/** 每页条数，默认 20，最大 100 */
	page_size?: number;
}

// ── 通用批量操作 ──

/** 批量写操作响应（删除、埋葬、重置、打标签等） */
export interface BatchResponse {
	ok: boolean;
	processed: number;
	succeeded: number;
	failed: number;
	errors?: BatchErrorDetail[];
}

/** 批量读操作响应（查询、读取等） */
export interface BatchDataResponse<T> {
	ok: boolean;
	processed: number;
	succeeded: number;
	failed: number;
	items: T[];
	errors?: BatchErrorDetail[];
}

/** 批量操作中单条错误详情 */
export interface BatchErrorDetail {
	index: number;
	code: string;
	message: string;
}

// ── 展示工具 ──

export const formatDate = (dateString: string): string => {
	try {
		const date = new Date(dateString);
		if (Number.isNaN(date.getTime())) {
			return dateString;
		}
		return date.toLocaleDateString("zh-CN", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return dateString;
	}
};
