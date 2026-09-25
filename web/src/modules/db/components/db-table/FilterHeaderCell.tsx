// 筛选行单元：操作符下拉（含无值操作）+ 值输入（从 DbTable.tsx 下钻）

import { type Component, For, Show } from "solid-js";
import type { ColumnInfo, FilterOpValue } from "../../api.ts";
import {
	type ColumnFilter,
	FILTER_OPS,
	isFilterOp,
	isValuelessOp,
} from "../../tableConfig.ts";
import styles from "../DbTable.module.css";

export interface FilterHeaderCellProps {
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

export default FilterHeaderCell;
