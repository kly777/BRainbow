import { Button } from "@components/ui";
import { getErrorMessage } from "@lib/api";
import { tryAsync } from "@lib/utils";
import { useSearchParams } from "@solidjs/router";
import {
	type Component,
	createEffect,
	createSignal,
	For,
	onMount,
	Show,
} from "solid-js";
import {
	type ColumnInfo,
	downloadTableExport,
	getTableDataE,
	getTablesE,
} from "./api";
import DbTable from "./components/DbTable";
import FilterChips from "./components/FilterChips";
import PaginationBar from "./components/PaginationBar";
import styles from "./DbViewer.module.css";
import {
	type ColumnFilter,
	filtersFromParams,
	PAGE_SIZES,
} from "./tableConfig";

const TableHeaderActions: Component<{
	filters: readonly ColumnFilter[];
	refFilter: { col: string; id: number } | null;
	showFilterChips: boolean;
	exporting: "" | "csv" | "json";
	onRemove: (col: string) => void;
	onClear: () => void;
	onExport: (format: "csv" | "json") => void;
}> = (props) => (
	<div class={styles.tableActions}>
		{/* 过滤状态与标题同排显示，出现/消失不改变表格纵向位置 */}
		<Show when={props.showFilterChips}>
			<FilterChips
				filters={props.filters}
				refFilter={props.refFilter}
				onRemove={props.onRemove}
				onClear={props.onClear}
			/>
		</Show>

		<div class={styles.exportGroup}>
			<Button
				variant="secondary"
				size="sm"
				disabled={props.exporting !== ""}
				onClick={() => void props.onExport("csv")}
			>
				{props.exporting === "csv" ? "导出中…" : "CSV"}
			</Button>
			<Button
				variant="secondary"
				size="sm"
				disabled={props.exporting !== ""}
				onClick={() => void props.onExport("json")}
			>
				{props.exporting === "json" ? "导出中…" : "JSON"}
			</Button>
		</div>
	</div>
);

const DB: Component = () => {
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
	const hasFilters = () => filters().length > 0;
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

	const writeFilters = (next: readonly ColumnFilter[]) => {
		setSearchParams({
			page: 1,
			fcol: next.map((f) => f.col),
			fop: next.map((f) => f.op),
			fval: next.map((f) => f.val),
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

	const toggleSort = (col: string) => {
		const nextDesc = sortCol() === col ? !sortDesc() : false;
		setSearchParams({
			sort: col,
			order: nextDesc ? "desc" : "asc",
			page: 1,
		});
	};

	const setColumnFilter = (
		col: string,
		op: ColumnFilter["op"],
		value: string,
	) => {
		const next = filters().filter((f) => f.col !== col);
		const valueless = op === "null" || op === "notnull";
		if (valueless || value.trim()) {
			next.push({ col, op, val: valueless ? "" : value });
		}
		writeFilters(next);
	};

	const removeColumnFilter = (col: string) => {
		writeFilters(filters().filter((f) => f.col !== col));
	};

	const clearFilters = () => {
		setSearchParams({
			page: 1,
			id: undefined,
			ref_col: undefined,
			fcol: [],
			fop: [],
			fval: [],
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

	// URL 是表格状态的唯一来源：前进/后退、浏览器刷新、程序内 setSearchParams
	// 都走同一个 effect 拉取，避免 URL 变了但表格没变。
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

	return (
		<div class={styles.page}>
			<nav class={styles.sidebar} aria-label="数据库表列表">
				<div class={styles.sidebarTitle}>表列表</div>
				<For each={tables()}>
					{(t) => (
						<button
							type="button"
							onClick={() => openTable(t)}
							classList={{
								[styles.tableItem]: true,
								[styles.tableItemActive]: activeTable() === t,
							}}
							aria-pressed={activeTable() === t}
						>
							{t}
						</button>
					)}
				</For>
			</nav>

			<div class={styles.main}>
				{error() && <div class={styles.errorBox}>{error()}</div>}
				{loading() && columns().length === 0 && (
					<div class={styles.loading}>加载中…</div>
				)}

				{/* 首次数据到达前不渲染表格；之后请求期间保留旧表格，避免输入框/布局被重建 */}
				<Show when={activeTable() && columns().length > 0}>
					<div class={styles.tableHeader}>
						<h3 class={styles.tableTitle} title={activeTable()}>
							{activeTable()}
						</h3>

						<TableHeaderActions
							filters={filters()}
							refFilter={refFilter()}
							showFilterChips={filterId() > 0 || hasFilters()}
							exporting={exporting()}
							onRemove={removeColumnFilter}
							onClear={clearFilters}
							onExport={exportTable}
						/>
					</div>

					<DbTable
						tableName={activeTable()}
						columns={columns()}
						rows={rows()}
						filters={filters()}
						loading={loading()}
						sortCol={sortCol()}
						sortDesc={sortDesc()}
						previewFor={previewFor}
						onSort={toggleSort}
						onSetFilter={setColumnFilter}
						onJumpToRef={jumpToRef}
					/>

					<PaginationBar
						total={total()}
						page={currentPage()}
						pageSize={currentPageSize()}
						totalPages={totalPages()}
						filtered={filterId() > 0 || hasFilters()}
						loading={loading()}
						jumpValue={jumpValue()}
						onJumpInput={setJumpValue}
						onJump={reloadTable}
						onPageSizeChange={(size) =>
							setSearchParams({
								page: 1,
								page_size: String(size),
							})
						}
						onPrev={() => reloadTable(currentPage() - 1)}
						onNext={() => reloadTable(currentPage() + 1)}
					/>
				</Show>
			</div>
		</div>
	);
};

export default DB;
