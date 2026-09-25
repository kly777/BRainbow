import { getErrorMessage } from "@shared/api";
import { createSignal } from "solid-js";
import { type ColumnInfo, downloadTableExport } from "../api.ts";
import type { ColumnFilter } from "../tableConfig.ts";
import { useDbTableLoader } from "./db-viewer/useDbTableLoader.ts";
import { useDbViewerParams } from "./db-viewer/useDbViewerParams.ts";
import { useTableFilters } from "./useTableFilters.ts";

export interface DbViewerApi {
	tables: () => string[];
	activeTable: () => string;
	currentPage: () => number;
	currentPageSize: () => number;
	totalPages: () => number;
	filterId: () => number;
	filterCol: () => string;
	hasFilters: () => boolean;
	sortCol: () => string;
	sortDesc: () => boolean;
	filters: () => ColumnFilter[];
	refFilter: () => { col: string; id: number } | null;
	columns: () => ColumnInfo[];
	rows: () => string[][];
	total: () => number;
	loading: () => boolean;
	error: () => string;
	exporting: () => "" | "csv" | "json";
	jumpValue: () => string;
	openTable: (name: string) => void;
	reloadTable: (page: number) => void;
	toggleSort: (col: string) => void;
	setColumnFilter: (col: string, op: ColumnFilter["op"], value: string) => void;
	removeColumnFilter: (col: string) => void;
	clearFilters: () => void;
	jumpToRef: (targetTable: string, refCol: string, value: string) => void;
	previewFor: (table: string, value: string) => string;
	exportTable: (format: "csv" | "json") => Promise<void>;
	setJumpValue: (value: string) => void;
	changePageSize: (size: number) => void;
}

/**
 * DB 浏览器（/db）的组合入口：URL 参数 → 取数 → 列筛选 → 表格操作。
 *
 * 拆分动机（迁移手册 T3，原文件 413 行）：参数翻译、取数、筛选、操作四件事挤在一个
 * 函数里，改一处翻页要在 400 行里找。现在：
 * - `db-viewer/useDbViewerParams.ts`：URL ↔ 语义化访问器（查询状态的唯一来源）
 * - `db-viewer/useDbTableLoader.ts`：表清单 + 列/行/引用预览 + 防抖取数
 * - 本文件：列筛选（原有 useTableFilters）+ 翻页/跳转/排序/导出/清筛选等**操作**
 * 对外 API 一字未改，DbViewer.tsx 不用动。
 */
export function useDbViewer(): DbViewerApi {
	const p = useDbViewerParams();
	const loader = useDbTableLoader(p);
	const [exporting, setExporting] = createSignal<"" | "csv" | "json">("");

	// ── 列筛选/排序（写回 URL，页面回到第 1 页） ──
	const tableFilters = useTableFilters({
		filters: p.filters,
		sortCol: p.sortCol,
		sortDesc: p.sortDesc,
		writeFilters: (next) => {
			p.params.set({
				page: 1,
				fcol: next.map((f) => f.col),
				fop: next.map((f) => f.op),
				fval: next.map((f) => f.val),
			});
		},
		writeSort: (col, desc) => {
			p.params.set({
				sort: col,
				order: desc ? "desc" : "asc",
				page: 1,
			});
		},
	});

	/** 换表：清掉上一张表的页码/引用过滤/排序/筛选，回到默认视图 */
	const openTable = (name: string) => {
		loader.cancelDebouncedFetch();
		p.params.set({
			table: name,
			page: 1,
			page_size: undefined,
			id: undefined,
			ref_col: undefined,
			sort: undefined,
			order: undefined,
			fcol: [],
			fop: [],
			fval: [],
		});
	};

	/** 翻页：写回 URL 后立即取数（绕过防抖），并让 effect 空跑一轮 */
	const reloadTable = (targetPage: number) => {
		const table = p.activeTable();
		if (!table) return;
		const activeFilters = p.filters();
		loader.cancelDebouncedFetch();
		loader.skipNextFetch();
		p.params.set({
			table,
			page: targetPage,
			page_size: p.currentPageSize(),
			id: p.filterId() > 0 ? p.filterId() : undefined,
			ref_col: p.filterId() > 0 ? p.filterCol() : undefined,
			sort: p.sortCol() || undefined,
			order: p.sortCol() ? (p.sortDesc() ? "desc" : "asc") : undefined,
			fcol: activeFilters.map((f) => f.col),
			fop: activeFilters.map((f) => f.op),
			fval: activeFilters.map((f) => f.val),
		});
		void loader.fetchTable(
			table,
			targetPage,
			p.currentPageSize(),
			p.filterId(),
			p.filterCol(),
			p.sortCol(),
			p.sortDesc(),
			activeFilters,
		);
	};

	/** 跳到被引用的那一行：非整数值退化成"打开目标表" */
	const jumpToRef = (targetTable: string, refCol: string, value: string) => {
		const id = Number(value);
		if (Number.isInteger(id) && id >= 1) {
			loader.cancelDebouncedFetch();
			loader.skipNextFetch();
			p.params.set({
				table: targetTable,
				page: 1,
				page_size: undefined,
				id,
				ref_col: refCol,
				sort: undefined,
				order: undefined,
				fcol: [],
				fop: [],
				fval: [],
			});
			void loader.fetchTable(
				targetTable,
				1,
				p.currentPageSize(),
				id,
				refCol,
				"",
				false,
				[],
			);
		} else {
			openTable(targetTable);
		}
	};

	const exportTable = async (format: "csv" | "json") => {
		const table = p.activeTable();
		if (!table) return;
		setExporting(format);
		loader.setError("");
		const activeFilters = p.filters();
		try {
			await downloadTableExport(table, {
				id: p.filterId() > 0 ? p.filterId() : undefined,
				ref_col: p.filterId() > 0 ? p.filterCol() : undefined,
				sort: p.sortCol() || undefined,
				order: p.sortCol() ? (p.sortDesc() ? "desc" : "asc") : undefined,
				fcol: activeFilters.map((f) => f.col),
				fop: activeFilters.map((f) => f.op),
				fval: activeFilters.map((f) => f.val),
				format,
			});
		} catch (cause) {
			loader.setError(getErrorMessage(cause));
		} finally {
			setExporting("");
		}
	};

	const clearFilters = () => {
		loader.cancelDebouncedFetch();
		p.params.set({
			page: 1,
			id: undefined,
			ref_col: undefined,
			fcol: undefined,
			fop: undefined,
			fval: undefined,
		});
	};

	const changePageSize = (size: number) => {
		p.params.set({ page: 1, page_size: size });
	};

	return {
		tables: loader.tables,
		activeTable: p.activeTable,
		currentPage: p.currentPage,
		currentPageSize: p.currentPageSize,
		totalPages: loader.totalPages,
		filterId: p.filterId,
		filterCol: p.filterCol,
		hasFilters: tableFilters.hasFilters,
		sortCol: p.sortCol,
		sortDesc: p.sortDesc,
		filters: p.filters,
		refFilter: p.refFilter,
		columns: loader.columns,
		rows: loader.rows,
		total: loader.total,
		loading: loader.loading,
		error: loader.error,
		exporting,
		jumpValue: loader.jumpValue,
		openTable,
		reloadTable,
		toggleSort: tableFilters.toggleSort,
		setColumnFilter: tableFilters.setColumnFilter,
		removeColumnFilter: tableFilters.removeColumnFilter,
		clearFilters,
		jumpToRef,
		previewFor: loader.previewFor,
		exportTable,
		setJumpValue: loader.setJumpValue,
		changePageSize,
	};
}
