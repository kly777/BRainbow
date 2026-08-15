import { Button, SearchInput } from "@components/ui";
import { type Component, createSignal } from "solid-js";
import styles from "./CardFilter.module.css";

export interface CardFilterProps {
	onSearch?: (query: string) => void;
	initialQuery?: string;
	sortBy?: "created" | "updated";
	sortOrder?: "asc" | "desc";
	onSortChange?: (by: "created" | "updated", order: "asc" | "desc") => void;
}

const CardFilter: Component<CardFilterProps> = (props) => {
	const [sortBy, setSortBy] = createSignal<"created" | "updated">(
		props.sortBy || "updated",
	);
	const [sortOrder, setSortOrder] = createSignal<"asc" | "desc">(
		props.sortOrder || "desc",
	);

	const toggleSortOrder = () => {
		const next = sortOrder() === "asc" ? "desc" : "asc";
		setSortOrder(next);
		props.onSortChange?.(sortBy(), next);
	};

	const handleSortBy = (value: string) => {
		const by = value as "created" | "updated";
		setSortBy(by);
		props.onSortChange?.(by, sortOrder());
	};

	return (
		<div class={styles.filters}>
			<div class={styles.filterRow}>
				<div class={styles.filterControls}>
					<SearchInput
						class={styles.searchInput}
						placeholder="搜索卡片…"
						value={props.initialQuery ?? ""}
						onSearch={(q) => props.onSearch?.(q)}
					/>
					<label class={styles.filterLabel} for="card-sort-by">
						排序:
					</label>
					<select
						id="card-sort-by"
						class={styles.filterSelect}
						value={sortBy()}
						onChange={(e) => handleSortBy(e.currentTarget.value)}
					>
						<option value="updated">更新时间</option>
						<option value="created">创建时间</option>
					</select>
					<Button
						variant="icon"
						onClick={toggleSortOrder}
						title={sortOrder() === "asc" ? "升序" : "降序"}
						aria-label={sortOrder() === "asc" ? "切换为降序" : "切换为升序"}
					>
						{sortOrder() === "asc" ? "↑" : "↓"}
					</Button>
				</div>
			</div>
		</div>
	);
};

export default CardFilter;
