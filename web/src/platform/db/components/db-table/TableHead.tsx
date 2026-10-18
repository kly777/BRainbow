// 表头：列头行 + 可选的筛选行（从 DbTable.tsx 下钻）

import { type Component, Index, Show } from "solid-js";
import type { ColumnInfo, FilterOpValue } from "../../api.ts";
import type { ColumnFilter } from "../../tableConfig.ts";
import styles from "../DbTable.module.css";
import FilterHeaderCell from "./FilterHeaderCell.tsx";
import SortHeaderCell from "./SortHeaderCell.tsx";

export interface TableHeadProps {
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

export default TableHead;
