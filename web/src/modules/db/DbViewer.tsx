import { Button } from "@components/ui";
import { getErrorMessage } from "@lib/api";
import { tryAsync } from "@lib/utils";
import { useSearchParams } from "@solidjs/router";
import { type Component, createSignal, For, onMount } from "solid-js";
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

	const loadTable = async (name: string, targetPage = 1) => {
		setSearchParams({ table: name || undefined, page: targetPage });
		setLoading(true);
		setError("");
		const result = await tryAsync(() =>
			getTableDataE(name, { page: targetPage, page_size: PAGE_SIZE }),
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

	onMount(() => {
		loadTables();
		if (activeTable()) {
			loadTable(activeTable(), currentPage());
		}
	});

	return (
		<div class={styles.page}>
			<nav class={styles.sidebar} aria-label="数据库表列表">
				<div class={styles.sidebarTitle}>表列表</div>
				<For each={tables()}>
					{(t) => (
						<button
							type="button"
							onClick={() => loadTable(t)}
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
						<div class={styles.tableWrap}>
							<table class={styles.table}>
								<thead>
									<tr>
										<For each={columns()}>
											{(c) => (
												<th scope="col">
													<div class={styles.colName}>{c.name}</div>
													<div class={styles.colType}>{c.col_type}</div>
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
													{(cell) => (
														<td title={String(cell)}>{String(cell)}</td>
													)}
												</For>
											</tr>
										)}
									</For>
								</tbody>
							</table>
						</div>
						<div class={styles.pagination}>
							<span>
								共 {total()} 行 · 第 {currentPage()} / {totalPages()} 页
							</span>
							<Button
								variant="secondary"
								size="sm"
								disabled={currentPage() <= 1 || loading()}
								onClick={() => loadTable(activeTable(), currentPage() - 1)}
							>
								上一页
							</Button>
							<Button
								variant="secondary"
								size="sm"
								disabled={currentPage() >= totalPages() || loading()}
								onClick={() => loadTable(activeTable(), currentPage() + 1)}
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
