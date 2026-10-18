// 数据行：逐行渲染 + 展开反向引用（从 DbTable.tsx 下钻）

import { type Component, Index, Show } from "solid-js";
import type { ColumnInfo } from "../../api.ts";
import BackRefs from "../BackRefs.tsx";
import styles from "../DbTable.module.css";
import RowCell from "./RowCell.tsx";

export interface TableRowsProps {
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

export default TableRows;
