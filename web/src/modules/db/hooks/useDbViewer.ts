import { getErrorMessage } from "@lib/api";
import { tryAsync } from "@lib/utils";
import { useSearchParams } from "@solidjs/router";
import { createEffect, createSignal, onMount } from "solid-js";
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
	const [searchParams, setSearchParams] = useSearchParams();
	const [tables, setTables] = createSignal<string[]>([]);
	const activeTable = () => {
		const t = searchParams.table;
		return typeof t === "string" ? t : "";
	};
	const currentPage = () => {
		const p = Number(searchParams.page);
		return Number.isInteger(p) && p >= 1 ? p : 1;
	};
	const currentPageSize = () => {
		const raw = Number(searchParams.page_size);
		return PAGE_SIZES.some((size) => size === raw) ? raw : 50;
	};
	const filterId = () => {
		const raw = searchParams.id;
		const n = Number(raw);
		return typeof raw === "string" && Number.isInteger(n) && n >= 1 ? n : 0;
	};
	const filterCol = () => {
		const raw = searchParams.ref_col;
		return typeof raw === "string" && raw ? raw : "id";
	};
	const sortCol = () =>
		typeof searchParams.sort === "string" ? searchParams.sort : "";
	const sortDesc = () => searchParams.order === "desc";
	const filters = () =>
		filtersFromParams(searchParams.fcol, searchParams.fop, searchParams.fval);
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

	const totalPages = () => Math.max(1, Math.ceil(total() / currentPageSize()));

	// ── 子 hook：筛选/排序 ──
	const tableFilters = useTableFilters({
		filters,
		sortCol,
		sortDesc,
		writeFilters: (next) => {
			setSearchParams({
				page: 1,
				fcol: next.map((f) => f.col),
				fop: next.map((f) => f.op),
				fval: next.map((f) => f.val),
			});
		},
		writeSort: (col, desc) => {
			setSearchParams({
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
		setSearchParams({
			table: name || undefined,
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
		setSearchParams({
			table,
			page: targetPage,
			page_size: String(currentPageSize()),
			id: filterId() > 0 ? String(filterId()) : undefined,
			ref_col: filterId() > 0 ? filterCol() : undefined,
			sort: sortCol() || undefined,
			order: sortCol() ? (sortDesc() ? "desc" : "asc") : undefined,
			fcol: activeFilters.map((f) => f.col),
			fop: activeFilters.map((f) => f.op),
			fval: activeFilters.map((f) => f.val),
		});
	};

	const jumpToRef = (targetTable: string, refCol: string, value: string) => {
		const id = Number(value);
		if (Number.isInteger(id) && id >= 1) {
			setSearchParams({
				table: targetTable,
				page: 1,
				page_size: undefined,
				id: String(id),
				ref_col: refCol,
				sort: undefined,
				order: undefined,
				fcol: [],
				fop: [],
				fval: [],
			});
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
		void fetchTable(
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
		setSearchParams({
			page: 1,
			page_size: String(size),
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
		clearFilters: tableFilters.clearFilters,
		jumpToRef,
		previewFor,
		exportTable,
		setJumpValue,
		changePageSize,
	};
}
