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

// ── 通用响应 ──

// ── 展示工具 ──

export const formatDate = (dateString: string): string => {
    try {
        const date = new Date(dateString);
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
