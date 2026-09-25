// 列头单元：点击排序 + 外键提示（从 DbTable.tsx 下钻出来的，见 §5 体检表）

import { ArrowRight } from "@components/ui/icons";
import { type Component, Show } from "solid-js";
import type { ColumnInfo } from "../../api.ts";
import styles from "../DbTable.module.css";

export interface SortHeaderCellProps {
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

export default SortHeaderCell;
