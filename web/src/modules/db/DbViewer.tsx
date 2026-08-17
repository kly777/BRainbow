import { Button } from "@components/ui";
import { getErrorMessage } from "@lib/api";
import { tryAsync } from "@lib/utils";
import { useSearchParams } from "@solidjs/router";
import {
	type Component,
	createEffect,
	createSignal,
	For,
	Index,
	onMount,
	Show,
} from "solid-js";
import {
	type ColumnInfo,
	downloadTableExport,
	getTableDataE,
	getTablesE,
} from "./api";
import styles from "./DbViewer.module.css";

const DB: Component = () => {
	const [searchParams, setSearchParams] = useSearchParams();
	const [tables, setTables] = createSignal<string[]>([]);
	const PAGE_SIZES = [20, 50, 100, 200] as const;
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
	const searchCol = () =>
		typeof searchParams.fcol === "string" ? searchParams.fcol : "";
	const searchValue = () =>
		typeof searchParams.q === "string" ? searchParams.q : "";

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
		fcol: string,
		q: string,
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
				fcol: fcol || undefined,
				q: q || undefined,
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
			fcol: undefined,
			q: undefined,
		});
	};

	const reloadTable = (targetPage: number) => {
		const table = activeTable();
		if (!table) return;
		setSearchParams({
			table,
			page: targetPage,
			page_size: String(currentPageSize()),
			id: filterId() > 0 ? String(filterId()) : undefined,
			ref_col: filterId() > 0 ? filterCol() : undefined,
			sort: sortCol() || undefined,
			order: sortCol() ? (sortDesc() ? "desc" : "asc") : undefined,
			fcol: searchCol() || undefined,
			q: searchValue() || undefined,
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

	const setSearchFilter = (col: string, value: string) => {
		setSearchParams({
			fcol: value ? col : undefined,
			q: value || undefined,
			page: 1,
		});
	};

	const clearFilters = () => openTable(activeTable());

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
				fcol: undefined,
				q: undefined,
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
		try {
			await downloadTableExport(table, {
				id: filterId() > 0 ? filterId() : undefined,
				ref_col: filterId() > 0 ? filterCol() : undefined,
				sort: sortCol() || undefined,
				order: sortCol() ? (sortDesc() ? "desc" : "asc") : undefined,
				fcol: searchCol() || undefined,
				q: searchValue() || undefined,
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
		const fcol = searchCol();
		const q = searchValue();
		setJumpValue(String(page));
		if (!table) return;
		void fetchTable(table, page, pageSize, id, refCol, sort, desc, fcol, q);
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

						<div class={styles.tableActions}>
							{/* 过滤状态与标题同排显示，出现/消失不改变表格纵向位置 */}
							<Show when={filterId() > 0 || searchValue().length > 0}>
								<div class={styles.filterBar}>
									<span class={styles.filterText}>
										<Show when={filterId() > 0}>
											<code class={styles.filterCode}>
												{filterCol()} = {filterId()}
											</code>
										</Show>
										<Show when={searchValue().length > 0}>
											<code class={styles.filterCode}>
												{searchCol()} 包含 “{searchValue()}”
											</code>
										</Show>
									</span>
									<button
										type="button"
										class={styles.filterClear}
										onClick={clearFilters}
									>
										清除过滤
									</button>
								</div>
							</Show>

							<div class={styles.exportGroup}>
								<Button
									variant="secondary"
									size="sm"
									disabled={exporting() !== ""}
									onClick={() => void exportTable("csv")}
								>
									{exporting() === "csv" ? "导出中…" : "CSV"}
								</Button>
								<Button
									variant="secondary"
									size="sm"
									disabled={exporting() !== ""}
									onClick={() => void exportTable("json")}
								>
									{exporting() === "json" ? "导出中…" : "JSON"}
								</Button>
							</div>
						</div>
					</div>

					<div
						class={styles.tableWrap}
						aria-busy={loading() ? "true" : "false"}
					>
						<Show when={loading()}>
							<div class={styles.tableLoading}>加载中…</div>
						</Show>
						<table class={styles.table}>
							<thead>
								<tr>
									<Index each={columns()}>
										{(c) => (
											<th scope="col">
												<button
													type="button"
													class={styles.sortBtn}
													onClick={() => toggleSort(c().name)}
													title="点击排序"
												>
													<span class={styles.colName}>{c().name}</span>
													<span class={styles.colType}>{c().col_type}</span>
													<Show when={sortCol() === c().name}>
														<span class={styles.sortMark}>
															{sortDesc() ? "↓" : "↑"}
														</span>
													</Show>
												</button>
												<Show when={c().ref_table}>
													<div class={styles.refHint}>→ {c().ref_table}</div>
												</Show>
											</th>
										)}
									</Index>
								</tr>
								<tr class={styles.filterRow}>
									<Index each={columns()}>
										{(c) => (
											<th scope="col">
												<input
													type="text"
													class={styles.filterInput}
													placeholder="筛选…"
													value={searchCol() === c().name ? searchValue() : ""}
													onInput={(e) =>
														setSearchFilter(c().name, e.currentTarget.value)
													}
												/>
											</th>
										)}
									</Index>
								</tr>
							</thead>
							<tbody>
								{rows().length === 0 && (
									<tr>
										<td class={styles.emptyCell} colspan={columns().length}>
											无数据
										</td>
									</tr>
								)}
								<Index each={rows()}>
									{(row) => (
										<tr>
											<Index each={row()}>
												{(cell, cellI) => {
													const col = () => columns()[cellI];
													const text = () => String(cell());
													const preview = () =>
														col()?.ref_table
															? previewFor(col()!.ref_table!, text())
															: "";
													return (
														<td title={text()}>
															<Show
																when={col()?.ref_table && text()}
																fallback={<span>{text()}</span>}
															>
																<button
																	type="button"
																	class={styles.cellLink}
																	title={
																		preview()
																			? `${text()} · ${preview()}`
																			: `跳转到 ${col()?.ref_table}`
																	}
																	onClick={() =>
																		jumpToRef(
																			col()?.ref_table ?? "",
																			col()?.ref_column ?? "id",
																			text(),
																		)
																	}
																>
																	<span class={styles.cellValue}>{text()}</span>
																	<Show when={preview()}>
																		<span class={styles.cellPreview}>
																			{preview()}
																		</span>
																	</Show>
																</button>
															</Show>
														</td>
													);
												}}
											</Index>
										</tr>
									)}
								</Index>
							</tbody>
						</table>
					</div>
					<div class={styles.pagination}>
						<span class={styles.paginationInfo}>
							{filterId() > 0 || searchValue().length > 0
								? `匹配 ${total()} 行`
								: `共 ${total()} 行`}
							· 第 {currentPage()} / {totalPages()} 页
						</span>
						<label class={styles.pageSize}>
							每页
							<select
								class={styles.pageSizeSelect}
								value={String(currentPageSize())}
								onChange={(e) =>
									setSearchParams({
										page: 1,
										page_size: e.currentTarget.value,
									})
								}
							>
								<For each={PAGE_SIZES}>
									{(size) => <option value={size}>{size}</option>}
								</For>
							</select>
						</label>
						<form
							class={styles.pageJump}
							onSubmit={(e) => {
								e.preventDefault();
								const n = Number(jumpValue());
								const target = Number.isInteger(n)
									? Math.min(Math.max(1, n), totalPages())
									: currentPage();
								reloadTable(target);
							}}
						>
							<input
								type="number"
								class={styles.pageJumpInput}
								min="1"
								max={totalPages()}
								value={jumpValue()}
								onInput={(e) => setJumpValue(e.currentTarget.value)}
								aria-label="跳转页码"
							/>
							<Button
								variant="secondary"
								size="sm"
								type="submit"
								disabled={loading()}
							>
								跳转
							</Button>
						</form>
						<Button
							variant="secondary"
							size="sm"
							disabled={currentPage() <= 1 || loading()}
							onClick={() => reloadTable(currentPage() - 1)}
						>
							上一页
						</Button>
						<Button
							variant="secondary"
							size="sm"
							disabled={currentPage() >= totalPages() || loading()}
							onClick={() => reloadTable(currentPage() + 1)}
						>
							下一页
						</Button>
					</div>
				</Show>
			</div>
		</div>
	);
};

export default DB;
