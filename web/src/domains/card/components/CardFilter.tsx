import { Button, SearchInput } from "@components/ui";
import type { Component } from "solid-js";
import styles from "./CardFilter.module.css";

export interface CardFilterProps {
	/** 当前搜索词（受控；输入框内部自持编辑态） */
	query?: string;
	onSearch: (query: string) => void;
	sortBy: "created" | "updated";
	sortOrder: "asc" | "desc";
	onSortChange: (by: "created" | "updated", order: "asc" | "desc") => void;
}

/** 全受控过滤栏：排序状态由父级持有，本组件只做展示与事件转发 */
const CardFilter: Component<CardFilterProps> = (props) => {
	const handleSortBy = (value: string) => {
		props.onSortChange(value as "created" | "updated", props.sortOrder);
	};

	const toggleSortOrder = () => {
		props.onSortChange(
			props.sortBy,
			props.sortOrder === "asc" ? "desc" : "asc",
		);
	};

	return (
		<div class={styles.filters}>
			<div class={styles.filterRow}>
				<div class={styles.filterControls}>
					<SearchInput
						class={styles.searchInput}
						placeholder="搜索卡片…"
						value={props.query ?? ""}
						onSearch={(q) => props.onSearch(q)}
					/>
					<label class={styles.filterLabel} for="card-sort-by">
						排序：
					</label>
					<select
						id="card-sort-by"
						class={styles.filterSelect}
						value={props.sortBy}
						onChange={(e) => handleSortBy(e.currentTarget.value)}
					>
						<option value="updated">更新时间</option>
						<option value="created">创建时间</option>
					</select>
					<Button
						variant="icon"
						onClick={toggleSortOrder}
						title={props.sortOrder === "asc" ? "升序" : "降序"}
						aria-label={props.sortOrder === "asc" ? "切换为降序" : "切换为升序"}
					>
						{props.sortOrder === "asc" ? "↑" : "↓"}
					</Button>
				</div>
			</div>
		</div>
	);
};

export default CardFilter;
