// ── DB 浏览器的取数层：表清单 + 当前表的列/行/引用预览 ──
//
// 从 useDbViewer 里切出来的第二块。这里只负责"把参数变成请求、把结果装进信号"：
// 数据信号、fetchTable、防抖 effect（URL 是表格状态的唯一来源）、引用预览。
// 翻页/跳转/排序这些**操作**留在入口 hook —— 它们改的是 URL，然后（可选地）立即取数。

import { getErrorMessage } from "@shared/api";
import { debounce, tryAsync } from "@shared/utils";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { ColumnInfo } from "../../api.ts";
import { getTableDataE, getTablesE } from "../../api.ts";
import type { ColumnFilter } from "../../tableConfig.ts";
import type { DbViewerParams } from "./useDbViewerParams.ts";

export function useDbTableLoader(p: DbViewerParams) {
	const [tables, setTables] = createSignal<string[]>([]);
	const [columns, setColumns] = createSignal<ColumnInfo[]>([]);
	const [rows, setRows] = createSignal<string[][]>([]);
	const [refPreviewMap, setRefPreviewMap] = createSignal<Map<string, string>>(
		new Map(),
	);
	const [total, setTotal] = createSignal(0);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal("");
	const [jumpValue, setJumpValue] = createSignal("1");
	// 显式操作（翻页、跳转）直接调用 fetchTable 后，跳过 effect 中的重复 fetch
	const [skipEffect, setSkipEffect] = createSignal(false);

	const totalPages = () =>
		Math.max(1, Math.ceil(total() / p.currentPageSize()));

	/** 显式操作已经自己取过数：让下一次 effect 空跑一轮 */
	const skipNextFetch = () => setSkipEffect(true);

	const loadTables = async () => {
		setLoading(true);
		const result = await tryAsync(() => getTablesE());
		if (result.ok) {
			setTables([...result.value]);
		} else {
			setError(getErrorMessage(result.error));
		}
		setLoading(false);
	};

	const fetchTable = async (
		name: string,
		targetPage: number,
		targetPageSize: number,
		id: number,
		refCol: string,
		sort: string,
		desc: boolean,
		targetFilters: readonly ColumnFilter[],
	) => {
		setLoading(true);
		setError("");
		const result = await tryAsync(() =>
			getTableDataE(name, {
				page: targetPage,
				page_size: targetPageSize,
				id: id > 0 ? id : undefined,
				ref_col: id > 0 ? refCol : undefined,
				sort: sort || undefined,
				order: sort ? (desc ? "desc" : "asc") : undefined,
				fcol: targetFilters.map((f) => f.col),
				fop: targetFilters.map((f) => f.op),
				fval: targetFilters.map((f) => f.val),
			}),
		);
		if (result.ok) {
			setColumns([...result.value.header]);
			setRows(result.value.rows.map((row) => row.map((v) => String(v ?? ""))));
			setTotal(result.value.total);
			const previews = new Map<string, string>();
			for (const ref of result.value.refs) {
				previews.set(`${ref.table}:${ref.id}`, ref.summary);
			}
			setRefPreviewMap(previews);
		} else {
			setError(getErrorMessage(result.error));
		}
		setLoading(false);
	};

	const previewFor = (table: string, value: string) => {
		const n = Number(value);
		if (!Number.isInteger(n) || n < 1) return "";
		return refPreviewMap().get(`${table}:${n}`) ?? "";
	};

	// 筛选输入防抖：URL 立即更新，fetch 延迟 200ms；显式操作（翻页/排序）绕过防抖
	const debouncedFetch = debounce(
		(
			name: string,
			targetPage: number,
			targetPageSize: number,
			id: number,
			refCol: string,
			sort: string,
			desc: boolean,
			targetFilters: readonly ColumnFilter[],
		) => {
			void fetchTable(
				name,
				targetPage,
				targetPageSize,
				id,
				refCol,
				sort,
				desc,
				targetFilters,
			);
		},
		200,
	);
	onCleanup(() => debouncedFetch.cancel());

	// URL 是表格状态的唯一来源
	createEffect(() => {
		const table = p.activeTable();
		const page = p.currentPage();
		const pageSize = p.currentPageSize();
		const id = p.filterId();
		const refCol = p.filterCol();
		const sort = p.sortCol();
		const desc = p.sortDesc();
		const activeFilters = p.filters();
		setJumpValue(String(page));
		if (!table) return;
		if (skipEffect()) {
			setSkipEffect(false);
			return;
		}
		debouncedFetch(
			table,
			page,
			pageSize,
			id,
			refCol,
			sort,
			desc,
			activeFilters,
		);
	});

	onMount(() => {
		void loadTables();
	});

	return {
		tables,
		columns,
		rows,
		total,
		totalPages,
		loading,
		error,
		setError,
		jumpValue,
		setJumpValue,
		loadTables,
		fetchTable,
		previewFor,
		skipNextFetch,
		cancelDebouncedFetch: () => debouncedFetch.cancel(),
	};
}

export type DbTableLoader = ReturnType<typeof useDbTableLoader>;
