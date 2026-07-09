import type { JSX } from "solid-js";
import { For } from "solid-js";
import styles from "./MemManageToolbar.module.css";

interface Props {
	searchQuery: string;
	filterState: string;
	onSearch: (value: string) => void;
	onFilterChange: (state: string) => void;
	onExport: () => void;
}

const FILTERS: [string, string][] = [
	["all", "全部"],
	["new", "新"],
	["learning", "学习"],
	["review", "复习"],
	["relearning", "重学"],
	["suspended", "挂起"],
	["today_done", "已复习"],
];

export default function MemManageToolbar(props: Props) {
	return (
		<div class={styles.toolbar}>
			<input
				type="search"
				class={styles.searchInput}
				placeholder="搜索线索或答案…"
				value={props.searchQuery}
				onInput={(e: InputEvent) => {
					const target = e.currentTarget as HTMLInputElement;
					props.onSearch(target.value);
				}}
			/>
			<div class={styles.toolRow}>
				<button type="button" class={styles.toolBtn} onClick={props.onExport}>
					导出
				</button>
			</div>
			<div class={styles.filterGroup}>
				<For each={FILTERS}>
					{([val, label]) => (
						<button
							type="button"
							class={props.filterState === val ? styles.filterActive : styles.filterBtn}
							onClick={() => props.onFilterChange(val)}
						>
							{label}
						</button>
					)}
				</For>
			</div>
		</div>
	);
}
