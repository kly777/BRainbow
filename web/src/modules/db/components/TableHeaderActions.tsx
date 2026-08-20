import { Button } from "@components/ui";
import { type Component, Show } from "solid-js";
import type { ColumnFilter } from "../tableConfig";
import FilterChips from "./FilterChips";
import styles from "./TableHeaderActions.module.css";

interface TableHeaderActionsProps {
	filters: readonly ColumnFilter[];
	refFilter: { col: string; id: number } | null;
	showFilterChips: boolean;
	exporting: "" | "csv" | "json";
	onRemove: (col: string) => void;
	onClear: () => void;
	onExport: (format: "csv" | "json") => void;
}

const TableHeaderActions: Component<TableHeaderActionsProps> = (props) => (
	<div class={styles.tableActions}>
		{/* 过滤状态与标题同排显示，出现/消失不改变表格纵向位置 */}
		<Show when={props.showFilterChips}>
			<FilterChips
				filters={props.filters}
				refFilter={props.refFilter}
				onRemove={props.onRemove}
				onClear={props.onClear}
			/>
		</Show>

		<div class={styles.exportGroup}>
			<Button
				variant="secondary"
				size="sm"
				disabled={props.exporting !== ""}
				onClick={() => void props.onExport("csv")}
			>
				{props.exporting === "csv" ? "导出中…" : "CSV"}
			</Button>
			<Button
				variant="secondary"
				size="sm"
				disabled={props.exporting !== ""}
				onClick={() => void props.onExport("json")}
			>
				{props.exporting === "json" ? "导出中…" : "JSON"}
			</Button>
		</div>
	</div>
);

export default TableHeaderActions;
