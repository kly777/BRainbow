import { getErrorMessage } from "@shared/api";
import {
	debounce,
	numParam,
	strParam,
	tryAsync,
	type UrlParamReader,
	useUrlParams,
} from "@shared/utils";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import {
	type ColumnInfo,
	downloadTableExport,
	getTableDataE,
	getTablesE,
} from "../api";
import {
	type ColumnFilter,
	filtersFromParams,
	PAGE_SIZES,
} from "../tableConfig";
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

export function useDbViewer(): DbViewerApi {
	/**
	 * db 专用多值参数 reader：兼容旧链接（重复参数 fcol=a&fcol=b）与新格式（逗号分隔），
	 * 保留空槽位（fval 与 fop/fcol 对齐，"null" 类操作的空值依赖它）。
	 */
	function arrayParam(): UrlParamReader<string[]> {
		return {
			read: (raw) => {
				const value: unknown = raw;
				if (typeof value === "string") return value.split(",");
				if (Array.isArray(value)) {
					return value.filter((x): x is string => typeof x === "string");
				}
				return [];
			},
			write: (vs) => (vs.length === 0 ? undefined : vs.join(",")),
		};
	}

	const params = useUrlParams({
		table: strParam(""),
		page: numParam(1, { min: 1 }),
		page_size: numParam(50, { min: 1 }),
		id: numParam(0, { min: 1 }),
		ref_col: strParam("id"),
		sort: strParam(""),
		order: strParam(""),
		fcol: arrayParam(),
		fop: arrayParam(),
		fval: arrayParam(),
	});
	const [tables, setTables] = createSignal<string[]>([]);
	const activeTable = () => params.get("table");
	const currentPage = () => params.get("page");
	const currentPageSize = () => {
		const raw = params.get("page_size");
		return PAGE_SIZES.some((size) => size === raw) ? raw : 50;
	};
	const filterId = () => params.get("id");
	const filterCol = () => params.get("ref_col");
	const sortCol = () => params.get("sort");
	const sortDesc = () => params.get("order") === "desc";
	const filters = () =>
		filtersFromParams(
			params.get("fcol"),
			params.get("fop"),
			params.get("fval"),
		);
	const refFilter = () =>
		filterId() > 0 ? { col: filterCol(), id: filterId() } : null;

	const [columns, setColumns] = createSignal<ColumnInfo[]>([]);
	const [rows, setRows] = createSignal<string[][]>([]);
	const [refPreviewMap, setRefPreviewMap] = createSignal<Map<string, string>>(
		new Map(),
	);
	const [total, setTotal] = createSignal(0);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal("");
	const [exporting, setExporting] = createSignal<"" | "csv" | "json">("");
	const [jumpValue, setJumpValue] = createSignal("1");
	// 显式操作（翻页、跳转）直接调用 fetchTable 后，跳过 effect 中的重复 fetch
	const [skipEffect, setSkipEffect] = createSignal(false);

	const totalPages = () => Math.max(1, Math.ceil(total() / currentPageSize()));

	// ── 子 hook：筛选/排序 ──
	const tableFilters = useTableFilters({
		filters,
		sortCol,
		sortDesc,
		writeFilters: (next) => {
			params.set({
				page: 1,
				fcol: next.map((f) => f.col),
				fop: next.map((f) => f.op),
				fval: next.map((f) => f.val),
			});
		},
		writeSort: (col, desc) => {
			params.set({
				sort: col,
				order: desc ? "desc" : "asc",
				page: 1,
			});
		},
	});

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

	const openTable = (name: string) => {
		debouncedFetch.cancel();
		params.set({
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

	const reloadTable = (targetPage: number) => {
		const table = activeTable();
		if (!table) return;
		const activeFilters = filters();
		debouncedFetch.cancel();
		setSkipEffect(true);
		params.set({
			table,
			page: targetPage,
			page_size: currentPageSize(),
			id: filterId() > 0 ? filterId() : undefined,
			ref_col: filterId() > 0 ? filterCol() : undefined,
			sort: sortCol() || undefined,
			order: sortCol() ? (sortDesc() ? "desc" : "asc") : undefined,
			fcol: activeFilters.map((f) => f.col),
			fop: activeFilters.map((f) => f.op),
			fval: activeFilters.map((f) => f.val),
		});
		// 翻页立即 fetch，不走防抖
		void fetchTable(
			table,
			targetPage,
			currentPageSize(),
			filterId(),
			filterCol(),
			sortCol(),
			sortDesc(),
			activeFilters,
		);
	};

	const jumpToRef = (targetTable: string, refCol: string, value: string) => {
		const id = Number(value);
		if (Number.isInteger(id) && id >= 1) {
			debouncedFetch.cancel();
			setSkipEffect(true);
			params.set({
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
			void fetchTable(
				targetTable,
				1,
				currentPageSize(),
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

	const previewFor = (table: string, value: string) => {
		const n = Number(value);
		if (!Number.isInteger(n) || n < 1) return "";
		return refPreviewMap().get(`${table}:${n}`) ?? "";
	};

	const exportTable = async (format: "csv" | "json") => {
		const table = activeTable();
		if (!table) return;
		setExporting(format);
		setError("");
		const activeFilters = filters();
		try {
			await downloadTableExport(table, {
				id: filterId() > 0 ? filterId() : undefined,
				ref_col: filterId() > 0 ? filterCol() : undefined,
				sort: sortCol() || undefined,
				order: sortCol() ? (sortDesc() ? "desc" : "asc") : undefined,
				fcol: activeFilters.map((f) => f.col),
				fop: activeFilters.map((f) => f.op),
				fval: activeFilters.map((f) => f.val),
				format,
			});
		} catch (cause) {
			setError(getErrorMessage(cause));
		} finally {
			setExporting("");
		}
	};

	// URL 是表格状态的唯一来源
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

	createEffect(() => {
		const table = activeTable();
		const page = currentPage();
		const pageSize = currentPageSize();
		const id = filterId();
		const refCol = filterCol();
		const sort = sortCol();
		const desc = sortDesc();
		const activeFilters = filters();
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

	const changePageSize = (size: number) => {
		params.set({
			page: 1,
			page_size: size,
		});
	};

	return {
		tables,
		activeTable,
		currentPage,
		currentPageSize,
		totalPages,
		filterId,
		filterCol,
		hasFilters: tableFilters.hasFilters,
		sortCol,
		sortDesc,
		filters,
		refFilter,
		columns,
		rows,
		total,
		loading,
		error,
		exporting,
		jumpValue,
		openTable,
		reloadTable,
		toggleSort: tableFilters.toggleSort,
		setColumnFilter: tableFilters.setColumnFilter,
		removeColumnFilter: tableFilters.removeColumnFilter,
		clearFilters: () => {
			debouncedFetch.cancel();
			params.set({
				page: 1,
				id: undefined,
				ref_col: undefined,
				fcol: undefined,
				fop: undefined,
				fval: undefined,
			});
		},
		jumpToRef,
		previewFor,
		exportTable,
		setJumpValue,
		changePageSize,
	};
}
