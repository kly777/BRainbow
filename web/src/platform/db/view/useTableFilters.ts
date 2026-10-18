// ── 表格筛选/排序逻辑 ──
// 从 useDbViewer 拆分：列筛选、排序、清除。

import type { ColumnFilter } from "../tableConfig";

export interface UseTableFiltersOpts {
	filters: () => ColumnFilter[];
	sortCol: () => string;
	sortDesc: () => boolean;
	/** 将筛选结果写入 URL searchParams */
	writeFilters: (next: readonly ColumnFilter[]) => void;
	/** 将排序结果写入 URL searchParams */
	writeSort: (col: string, desc: boolean) => void;
}

export function useTableFilters(opts: UseTableFiltersOpts) {
	const hasFilters = () => opts.filters().length > 0;

	const toggleSort = (col: string) => {
		const nextDesc = opts.sortCol() === col ? !opts.sortDesc() : false;
		opts.writeSort(col, nextDesc);
	};

	const setColumnFilter = (
		col: string,
		op: ColumnFilter["op"],
		value: string,
	) => {
		const next = opts.filters().filter((f) => f.col !== col);
		const valueless = op === "null" || op === "notnull";
		if (valueless || value.trim()) {
			next.push({ col, op, val: valueless ? "" : value });
		}
		opts.writeFilters(next);
	};

	const removeColumnFilter = (col: string) => {
		opts.writeFilters(opts.filters().filter((f) => f.col !== col));
	};

	const clearFilters = () => {
		opts.writeFilters([]);
	};

	return {
		hasFilters,
		toggleSort,
		setColumnFilter,
		removeColumnFilter,
		clearFilters,
	};
}
