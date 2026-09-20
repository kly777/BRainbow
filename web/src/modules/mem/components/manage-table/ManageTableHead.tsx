import { type Component, For, Show } from "solid-js";
import styles from "../ManageTable.module.css";
import type { SortDir, SortField } from "./types.ts";

const SORT_COLUMNS: { field: SortField; label: string }[] = [
	{ field: "state", label: "状态" },
	{ field: "difficulty", label: "难度" },
	{ field: "due_at", label: "复习" },
];

/** 表头：全选 + 线索/答案 + 三个可排序列表头 + 标签 + 操作 */
const ManageTableHead: Component<{
	allSelected: boolean;
	sortField: SortField;
	sortDir: SortDir;
	onToggleSort: (field: SortField) => void;
	onToggleAll: () => void;
}> = (props) => (
	<thead>
		<tr>
			<th class={styles.thCb}>
				<input
					type="checkbox"
					checked={props.allSelected}
					onInput={props.onToggleAll}
					aria-label="全选本页"
				/>
			</th>
			<th class={styles.th}>线索</th>
			<th class={styles.th}>答案</th>
			<For each={SORT_COLUMNS}>
				{({ field, label }) => (
					<th
						class={styles.thSort}
						aria-sort={
							props.sortField === field
								? props.sortDir === "asc"
									? "ascending"
									: "descending"
								: undefined
						}
					>
						<button
							type="button"
							class={styles.sortBtn}
							onClick={() => props.onToggleSort(field)}
						>
							{label}
							<Show when={props.sortField === field}>
								<span class={styles.sortIcon} aria-hidden="true">
									{props.sortDir === "asc" ? "▲" : "▼"}
								</span>
							</Show>
						</button>
					</th>
				)}
			</For>
			<th class={styles.th}>标签</th>
			<th class={styles.th}>
				<span class="sr-only">操作</span>
			</th>
		</tr>
	</thead>
);

export default ManageTableHead;
