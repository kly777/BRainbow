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
import { type ColumnInfo, getTableDataE, getTablesE } from "./api";
import styles from "./DbViewer.module.css";

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
	const filterId = () => {
		const raw = searchParams.id;
		const n = Number(raw);
		return typeof raw === "string" && Number.isInteger(n) && n >= 1 ? n : 0;
	};
	const filterCol = () => {
		const raw = searchParams.ref_col;
		return typeof raw === "string" && raw ? raw : "id";
	};

	const [columns, setColumns] = createSignal<ColumnInfo[]>([]);
	const [rows, setRows] = createSignal<string[][]>([]);
	const [total, setTotal] = createSignal(0);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal("");

	const PAGE_SIZE = 50;
	const totalPages = () => Math.max(1, Math.ceil(total() / PAGE_SIZE));

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
		id: number,
		refCol: string,
	) => {
		setLoading(true);
		setError("");
		const result = await tryAsync(() =>
			getTableDataE(name, {
				page: targetPage,
				page_size: PAGE_SIZE,
				id: id > 0 ? id : undefined,
				ref_col: id > 0 ? refCol : undefined,
			}),
		);
		if (result.ok) {
			setColumns([...result.value.header]);
			setRows(result.value.rows.map((row) => row.map((v) => String(v ?? ""))));
			setTotal(result.value.total);
		} else {
			setError(getErrorMessage(result.error));
		}
		setLoading(false);
	};

	const openTable = (name: string) => {
		setSearchParams({
			table: name || undefined,
			page: 1,
			id: undefined,
			ref_col: undefined,
		});
	};

	const reloadTable = (targetPage: number) => {
		const table = activeTable();
		if (!table) return;
		setSearchParams({
			table,
			page: targetPage,
			id: filterId() > 0 ? String(filterId()) : undefined,
			ref_col: filterId() > 0 ? filterCol() : undefined,
		});
	};

	const jumpToRef = (targetTable: string, refCol: string, value: string) => {
		const id = Number(value);
		if (Number.isInteger(id) && id >= 1) {
			setSearchParams({
				table: targetTable,
				page: 1,
				id: String(id),
				ref_col: refCol,
			});
		} else {
			openTable(targetTable);
		}
	};

	// URL 是表格状态的唯一来源：前进/后退、浏览器刷新、程序内 setSearchParams
	// 都走同一个 effect 拉取，避免 URL 变了但表格没变。
	createEffect(() => {
		const table = activeTable();
		const page = currentPage();
		const id = filterId();
		const refCol = filterCol();
		if (!table) return;
		void fetchTable(table, page, id, refCol);
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
				{loading() && <div class={styles.loading}>加载中…</div>}

				{activeTable() && !loading() && columns().length > 0 && (
					<>
						<h3 class={styles.tableTitle}>{activeTable()}</h3>

						{/* 跳转过滤提示：给用户明确的退出入口 */}
						<Show when={filterId() > 0}>
							<div class={styles.filterBar}>
								<span>
									正在查看 {activeTable()} 中{" "}
									<code class={styles.filterCode}>
										{filterCol()} = {filterId()}
									</code>{" "}
									的记录
								</span>
								<button
									type="button"
									class={styles.filterClear}
									onClick={() => openTable(activeTable())}
								>
									清除过滤 · 查看全部
								</button>
							</div>
						</Show>

						<div class={styles.tableWrap}>
							<table class={styles.table}>
								<thead>
									<tr>
										<For each={columns()}>
											{(c) => (
												<th scope="col">
													<div class={styles.colName}>{c.name}</div>
													<div class={styles.colType}>{c.col_type}</div>
													<Show when={c.ref_table}>
														<div class={styles.refHint}>→ {c.ref_table}</div>
													</Show>
												</th>
											)}
										</For>
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
									<For each={rows()}>
										{(row) => (
											<tr>
												<For each={row}>
													{(cell, i) => {
														const col = () => columns()[i()];
														const text = () => String(cell);
														return (
															<td title={text()}>
																<Show
																	when={col()?.ref_table && text()}
																	fallback={<span>{text()}</span>}
																>
																	<button
																		type="button"
																		class={styles.cellLink}
																		title={`跳转到 ${col()?.ref_table}`}
																		onClick={() =>
																			jumpToRef(
																				col()?.ref_table ?? "",
																				col()?.ref_column ?? "id",
																				text(),
																			)
																		}
																	>
																		{text()}
																	</button>
																</Show>
															</td>
														);
													}}
												</For>
											</tr>
										)}
									</For>
								</tbody>
							</table>
						</div>
						<div class={styles.pagination}>
							<span>
								{filterId() > 0
									? `匹配 ${total()} 行`
									: `共 ${total()} 行 · 第 ${currentPage()} / ${totalPages()} 页`}
							</span>
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
					</>
				)}
			</div>
		</div>
	);
};

export default DB;
