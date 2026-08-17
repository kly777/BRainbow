import { type Component, For, Index, Show } from "solid-js";
import type { ColumnInfo, FilterOpValue } from "../api";
import styles from "../DbViewer.module.css";
import {
	type ColumnFilter,
	FILTER_OPS,
	isFilterOp,
	isValuelessOp,
} from "../tableConfig";

interface DbTableProps {
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
	return (
		<div class={styles.tableWrap} aria-busy={props.loading ? "true" : "false"}>
			<Show when={props.loading}>
				<div class={styles.tableLoading}>加载中…</div>
			</Show>
			<table class={styles.table}>
				<thead>
					<tr>
						<Index each={props.columns}>
							{(c) => (
								<th scope="col">
									<button
										type="button"
										class={styles.sortBtn}
										onClick={() => props.onSort(c().name)}
										title="点击排序"
									>
										<span class={styles.colName}>{c().name}</span>
										<span class={styles.colType}>{c().col_type}</span>
										<Show when={props.sortCol === c().name}>
											<span class={styles.sortMark}>
												{props.sortDesc ? "↓" : "↑"}
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
						<Index each={props.columns}>
							{(c) => {
								const active = () =>
									props.filters.find((f) => f.col === c().name);
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
														props.onSetFilter(c().name, next, val());
													}
												}}
											>
												<For each={FILTER_OPS}>
													{(item) => (
														<option value={item.value}>{item.label}</option>
													)}
												</For>
											</select>
											<Show when={!isValuelessOp(op())}>
												<input
													type="text"
													class={styles.filterInput}
													placeholder="筛选…"
													value={val()}
													onInput={(e) =>
														props.onSetFilter(
															c().name,
															op(),
															e.currentTarget.value,
														)
													}
												/>
											</Show>
										</div>
									</th>
								);
							}}
						</Index>
					</tr>
				</thead>
				<tbody>
					{props.rows.length === 0 && (
						<tr>
							<td class={styles.emptyCell} colspan={props.columns.length}>
								无数据
							</td>
						</tr>
					)}
					<Index each={props.rows}>
						{(row) => (
							<tr>
								<Index each={row()}>
									{(cell, cellI) => {
										const col = () => props.columns[cellI];
										const text = () => String(cell());
										const preview = () =>
											col()?.ref_table
												? props.previewFor(col()!.ref_table!, text())
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
															props.onJumpToRef(
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
	);
};

export default DbTable;
