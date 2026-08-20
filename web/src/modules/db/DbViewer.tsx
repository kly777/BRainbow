import { type Component, For, Show } from "solid-js";
import DbTable from "./components/DbTable";
import PaginationBar from "./components/PaginationBar";
import TableHeaderActions from "./components/TableHeaderActions";
import styles from "./DbViewer.module.css";
import { useDbViewer } from "./hooks/useDbViewer.ts";

const DB: Component = () => {
	const m = useDbViewer();

	return (
		<div class={styles.page}>
			<nav class={styles.sidebar} aria-label="数据库表列表">
				<div class={styles.sidebarTitle}>表列表</div>
				<For each={m.tables()}>
					{(t) => (
						<button
							type="button"
							onClick={() => m.openTable(t)}
							classList={{
								[styles.tableItem]: true,
								[styles.tableItemActive]: m.activeTable() === t,
							}}
							aria-pressed={m.activeTable() === t}
						>
							{t}
						</button>
					)}
				</For>
			</nav>

			<div class={styles.main}>
				{m.error() && <div class={styles.errorBox}>{m.error()}</div>}
				{m.loading() && m.columns().length === 0 && (
					<div class={styles.loading}>加载中…</div>
				)}

				{/* 首次数据到达前不渲染表格；之后请求期间保留旧表格，避免输入框/布局被重建 */}
				<Show when={m.activeTable() && m.columns().length > 0}>
					<div class={styles.tableHeader}>
						<h3 class={styles.tableTitle} title={m.activeTable()}>
							{m.activeTable()}
						</h3>

						<TableHeaderActions
							filters={m.filters()}
							refFilter={m.refFilter()}
							showFilterChips={m.filterId() > 0 || m.hasFilters()}
							exporting={m.exporting()}
							onRemove={m.removeColumnFilter}
							onClear={m.clearFilters}
							onExport={m.exportTable}
						/>
					</div>

					<DbTable
						tableName={m.activeTable()}
						columns={m.columns()}
						rows={m.rows()}
						filters={m.filters()}
						loading={m.loading()}
						sortCol={m.sortCol()}
						sortDesc={m.sortDesc()}
						previewFor={m.previewFor}
						onSort={m.toggleSort}
						onSetFilter={m.setColumnFilter}
						onJumpToRef={m.jumpToRef}
					/>

					<PaginationBar
						total={m.total()}
						page={m.currentPage()}
						pageSize={m.currentPageSize()}
						totalPages={m.totalPages()}
						filtered={m.filterId() > 0 || m.hasFilters()}
						loading={m.loading()}
						jumpValue={m.jumpValue()}
						onJumpInput={m.setJumpValue}
						onJump={m.reloadTable}
						onPageSizeChange={m.changePageSize}
						onPrev={() => m.reloadTable(m.currentPage() - 1)}
						onNext={() => m.reloadTable(m.currentPage() + 1)}
					/>
				</Show>
			</div>
		</div>
	);
};

export default DB;
