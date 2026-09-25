// ── 表数据视图：表头（排序/筛选）+ 数据行 + 行详情抽屉 ──
//
// 六个子件（SortHeaderCell / FilterHeaderCell / TableHead / RowCell / EmptyRow /
// TableRows）已下钻到 `db-table/` 目录（doc/component-design.md §5 体检表：本文件
// 371 行里大半是内联子件）。这里只留组合：工具栏、表体、抽屉开合。

import { type Component, createEffect, createSignal, Show } from "solid-js";
import type { ColumnInfo, FilterOpValue } from "../api.ts";
import type { ColumnFilter } from "../tableConfig.ts";
import styles from "./DbTable.module.css";
import EmptyRow from "./db-table/EmptyRow.tsx";
import TableHead from "./db-table/TableHead.tsx";
import TableRows from "./db-table/TableRows.tsx";
import RowDetail from "./RowDetail.tsx";

interface DbTableProps {
	tableName: string;
	columns: readonly ColumnInfo[];
	rows: readonly string[][];
	filters: readonly ColumnFilter[];
	loading: boolean;
	sortCol: string;
	sortDesc: boolean;
	previewFor: (table: string, value: string) => string;
	onSort: (col: string) => void;
	onSetFilter: (col: string, op: FilterOpValue, value: string) => void;
	onJumpToRef: (targetTable: string, refCol: string, value: string) => void;
}

const DbTable: Component<DbTableProps> = (props) => {
	const [expandedRow, setExpandedRow] = createSignal<number | null>(null);
	const [detailKey, setDetailKey] = createSignal<string | null>(null);
	const [showFilters, setShowFilters] = createSignal(false);
	// 数据刷新或换表后展开/抽屉状态失效，自动收起
	createEffect(() => {
		props.rows;
		props.tableName;
		setExpandedRow(null);
		setDetailKey(null);
	});
	const primaryColName = () =>
		props.columns.find((c) => c.is_primary)?.name ?? "id";
	const toggleRow = (rowI: number) =>
		setExpandedRow((prev) => (prev === rowI ? null : rowI));

	return (
		<>
			<div
				class={styles.tableWrap}
				aria-busy={props.loading ? "true" : "false"}
			>
				<div class={styles.tableToolbar}>
					<button
						type="button"
						class={styles.filterToggle}
						classList={{ [styles.filterToggleActive]: showFilters() }}
						onClick={() => setShowFilters((v) => !v)}
						title={showFilters() ? "隐藏筛选" : "显示筛选"}
					>
						筛选
						<Show when={props.filters.length > 0}>
							<span class={styles.filterBadge}>{props.filters.length}</span>
						</Show>
					</button>
					<Show when={props.loading}>
						<span class={styles.tableLoading}>加载中…</span>
					</Show>
				</div>
				<table class={styles.table}>
					<TableHead
						columns={props.columns}
						sortCol={props.sortCol}
						sortDesc={props.sortDesc}
						onSort={props.onSort}
						filters={props.filters}
						onSetFilter={props.onSetFilter}
						showFilters={showFilters()}
					/>
					<tbody>
						{/* 加载中不给空行：工具栏已经写着"加载中…"，此时再说"无数据"是把两件事混成一句 */}
						{props.rows.length === 0 && !props.loading && (
							<EmptyRow colSpan={props.columns.length + 1} />
						)}
						<TableRows
							tableName={props.tableName}
							columns={props.columns}
							rows={props.rows}
							previewFor={props.previewFor}
							onJumpToRef={props.onJumpToRef}
							expandedRow={expandedRow}
							onToggleRow={toggleRow}
							onOpenDetail={(key) => setDetailKey(key)}
						/>
					</tbody>
				</table>
			</div>
			<Show when={detailKey()}>
				<RowDetail
					table={props.tableName}
					pkCol={primaryColName()}
					rowKey={detailKey() ?? ""}
					previewFor={props.previewFor}
					onJump={props.onJumpToRef}
					onClose={() => setDetailKey(null)}
				/>
			</Show>
		</>
	);
};

export default DbTable;
