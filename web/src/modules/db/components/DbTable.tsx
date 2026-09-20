import { EmptyState } from "@components/ui";
import { ArrowRight } from "@components/ui/icons";
import {
	type Component,
	createEffect,
	createSignal,
	For,
	Index,
	Show,
} from "solid-js";
import type { ColumnInfo, FilterOpValue } from "../api";
import {
	type ColumnFilter,
	FILTER_OPS,
	isFilterOp,
	isValuelessOp,
} from "../tableConfig";
import BackRefs from "./BackRefs";
import styles from "./DbTable.module.css";
import RowDetail from "./RowDetail";

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

interface SortHeaderCellProps {
	col: ColumnInfo;
	sortCol: string;
	sortDesc: boolean;
	onSort: (col: string) => void;
}

const SortHeaderCell: Component<SortHeaderCellProps> = (props) => {
	const isActive = () => props.sortCol === props.col.name;
	return (
		<th scope="col" class={isActive() ? styles.thActive : undefined}>
			<button
				type="button"
				class={styles.sortBtn}
				onClick={() => props.onSort(props.col.name)}
				title={`排序 ${props.col.name}`}
			>
				<span class={styles.colName}>{props.col.name}</span>
				<span class={styles.colType}>{props.col.col_type}</span>
				<Show when={isActive()}>
					<span class={styles.sortMark}>{props.sortDesc ? "↓" : "↑"}</span>
				</Show>
			</button>
			<Show when={props.col.ref_table}>
				<div class={styles.refHint} title={`外键 → ${props.col.ref_table}`}>
					<ArrowRight size={12} /> {props.col.ref_table}
				</div>
			</Show>
		</th>
	);
};

interface FilterHeaderCellProps {
	col: ColumnInfo;
	filters: readonly ColumnFilter[];
	onSetFilter: (col: string, op: FilterOpValue, value: string) => void;
}

const FilterHeaderCell: Component<FilterHeaderCellProps> = (props) => {
	const active = () => props.filters.find((f) => f.col === props.col.name);
	const op = () => active()?.op ?? "contains";
	const val = () => active()?.val ?? "";
	return (
		<th scope="col">
			<div class={styles.filterControls}>
				<select
					class={styles.filterOpSelect}
					value={op()}
					title="筛选方式"
					onChange={(e) => {
						const next = e.currentTarget.value;
						if (isFilterOp(next)) {
							props.onSetFilter(props.col.name, next, val());
						}
					}}
					aria-label={`筛选方式：${props.col.name}`}
				>
					<For each={FILTER_OPS}>
						{(item) => <option value={item.value}>{item.label}</option>}
					</For>
				</select>
				<Show when={!isValuelessOp(op())}>
					<input
						type="text"
						class={styles.filterInput}
						placeholder="筛选…"
						value={val()}
						onInput={(e) =>
							props.onSetFilter(props.col.name, op(), e.currentTarget.value)
						}
						aria-label={`筛选 ${props.col.name}`}
					/>
				</Show>
			</div>
		</th>
	);
};

interface TableHeadProps {
	columns: readonly ColumnInfo[];
	sortCol: string;
	sortDesc: boolean;
	onSort: (col: string) => void;
	filters: readonly ColumnFilter[];
	onSetFilter: (col: string, op: FilterOpValue, value: string) => void;
	showFilters: boolean;
}

const TableHead: Component<TableHeadProps> = (props) => (
	<thead>
		<tr>
			<th class={styles.rowToggleHead} scope="col" aria-label="反向引用" />
			<Index each={props.columns}>
				{(c) => (
					<SortHeaderCell
						col={c()}
						sortCol={props.sortCol}
						sortDesc={props.sortDesc}
						onSort={props.onSort}
					/>
				)}
			</Index>
		</tr>
		<Show when={props.showFilters}>
			<tr class={styles.filterRow}>
				<th scope="col" />
				<Index each={props.columns}>
					{(c) => (
						<FilterHeaderCell
							col={c()}
							filters={props.filters}
							onSetFilter={props.onSetFilter}
						/>
					)}
				</Index>
			</tr>
		</Show>
	</thead>
);

interface RowCellProps {
	col: ColumnInfo | undefined;
	text: string;
	preview: string;
	onJump: (targetTable: string, refCol: string, value: string) => void;
	onOpenDetail: (key: string) => void;
}

const RowCell: Component<RowCellProps> = (props) => (
	<td title={props.text}>
		<Show
			when={props.col?.ref_table && props.text}
			fallback={
				<Show when={props.col?.is_primary} fallback={<span>{props.text}</span>}>
					<button
						type="button"
						class={styles.primaryKeyLink}
						title="查看行详情"
						onClick={() => props.onOpenDetail(props.text)}
					>
						{props.text}
					</button>
				</Show>
			}
		>
			<button
				type="button"
				class={styles.cellLink}
				title={
					props.preview
						? `${props.text} · ${props.preview}`
						: `跳转到 ${props.col?.ref_table}`
				}
				onClick={() =>
					props.onJump(
						props.col?.ref_table ?? "",
						props.col?.ref_column ?? "id",
						props.text,
					)
				}
			>
				<span class={styles.cellValue}>{props.text}</span>
				<Show when={props.preview}>
					<span class={styles.cellPreview}>{props.preview}</span>
				</Show>
			</button>
		</Show>
	</td>
);

interface EmptyRowProps {
	colSpan: number;
}

const EmptyRow: Component<EmptyRowProps> = (props) => (
	<tr>
		<td colspan={props.colSpan}>
			<EmptyState title="无数据" compact />
		</td>
	</tr>
);

interface TableRowsProps {
	tableName: string;
	columns: readonly ColumnInfo[];
	rows: readonly string[][];
	previewFor: (table: string, value: string) => string;
	onJumpToRef: (targetTable: string, refCol: string, value: string) => void;
	expandedRow: () => number | null;
	onToggleRow: (rowI: number) => void;
	onOpenDetail: (key: string) => void;
}

const TableRows: Component<TableRowsProps> = (props) => (
	<Index each={props.rows}>
		{(row, rowI) => {
			const primaryIndex = () => props.columns.findIndex((c) => c.is_primary);
			const primaryValue = () => {
				const index = primaryIndex();
				return index >= 0 ? (row()[index] ?? "") : "";
			};
			const expanded = () => props.expandedRow() === rowI;
			return (
				<>
					<tr>
						<td class={styles.rowToggleCell}>
							<button
								type="button"
								class={styles.rowToggleBtn}
								title="查看哪些行引用了本行"
								aria-expanded={expanded()}
								onClick={() => props.onToggleRow(rowI)}
							>
								{expanded() ? "▾" : "↳"}
							</button>
						</td>
						<Index each={row()}>
							{(cell, cellI) => {
								const col = () => props.columns[cellI];
								const text = () => String(cell());
								const refTable = () => col()?.ref_table;
								const preview = () => {
									const rt = refTable();
									return rt ? props.previewFor(rt, text()) : "";
								};
								return (
									<RowCell
										col={col()}
										text={text()}
										preview={preview()}
										onJump={props.onJumpToRef}
										onOpenDetail={props.onOpenDetail}
									/>
								);
							}}
						</Index>
					</tr>
					<Show when={expanded()}>
						<tr class={styles.backrefRow}>
							<td colspan={props.columns.length + 1}>
								<BackRefs
									table={props.tableName}
									rowKey={primaryValue()}
									onJump={props.onJumpToRef}
								/>
							</td>
						</tr>
					</Show>
				</>
			);
		}}
	</Index>
);

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
						{props.rows.length === 0 && (
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
