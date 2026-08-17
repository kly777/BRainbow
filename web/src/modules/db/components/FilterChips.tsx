import { type Component, Index, Show } from "solid-js";
import styles from "../DbViewer.module.css";
import {
	type ColumnFilter,
	filterOpLabel,
	isValuelessOp,
} from "../tableConfig";

interface FilterChipsProps {
	filters: readonly ColumnFilter[];
	/** 跳转过滤（外键点击产生），非空时显示在最前 */
	refFilter: { col: string; id: number } | null;
	onRemove: (col: string) => void;
	onClear: () => void;
}

const FilterChips: Component<FilterChipsProps> = (props) => {
	return (
		<div class={styles.filterBar}>
			<span class={styles.filterText}>
				<Show when={props.refFilter}>
					{(ref) => (
						<code class={styles.filterCode}>
							{ref().col} = {ref().id}
						</code>
					)}
				</Show>
				<Index each={props.filters}>
					{(f) => (
						<button
							type="button"
							class={styles.filterChip}
							title="点击移除该筛选条件"
							onClick={() => props.onRemove(f().col)}
						>
							{f().col} {filterOpLabel(f().op)}
							{isValuelessOp(f().op) ? "" : ` ${f().val}`}
						</button>
					)}
				</Index>
			</span>
			<button type="button" class={styles.filterClear} onClick={props.onClear}>
				清除过滤
			</button>
		</div>
	);
};

export default FilterChips;
