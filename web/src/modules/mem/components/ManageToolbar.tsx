// ── v2 管理工具栏：搜索 / 标签过滤 / 状态筛选 / 导出 ──

import { Button, FilterGroup, SearchInput } from "@components/ui";
import type { TagInfo } from "@modules/mem";
import styles from "./ManageToolbar.module.css";
import TagPicker from "./TagPicker.tsx";

export type TagMode = "include" | "exclude";

interface Props {
	searchQuery: string;
	filterState: string;
	onSearch: (value: string) => void;
	onFilterChange: (state: string) => void;
	onExport: () => void;
	tagFilters: TagInfo[];
	tagMode: TagMode;
	onTagFiltersChange: (tags: TagInfo[], mode: TagMode) => void;
}

const FILTER_OPTIONS = [
	{ value: "all", label: "全部" },
	{ value: "new", label: "新" },
	{ value: "learning", label: "学习" },
	{ value: "review", label: "复习" },
	{ value: "relearning", label: "重学" },
	{ value: "suspended", label: "挂起" },
	{ value: "buried", label: "已埋葬" },
	{ value: "today_done", label: "已复习" },
];

export default function ManageToolbar(props: Props) {
	const setTags = (tags: TagInfo[]) =>
		props.onTagFiltersChange(tags, props.tagMode);

	return (
		<div class={styles.toolbar}>
			{/* 搜索 */}
			<div class={styles.searchBox}>
				<SearchInput
					value={props.searchQuery}
					onSearch={props.onSearch}
					placeholder="搜索线索或答案…"
				/>
			</div>

			{/* 状态筛选 */}
			<div class={styles.filterGroup}>
				<FilterGroup
					options={FILTER_OPTIONS}
					selected={props.filterState}
					onChange={props.onFilterChange}
				/>
			</div>

			{/* 标签过滤 */}
			<div class={styles.tagFilter}>
				<TagPicker
					selected={props.tagFilters}
					onAdd={(tag) => {
						if (!props.tagFilters.some((t) => t.id === tag.id)) {
							setTags([...props.tagFilters, tag]);
						}
					}}
					onRemove={(id) =>
						setTags(props.tagFilters.filter((t) => t.id !== id))
					}
					mode={props.tagMode}
					onModeToggle={() =>
						props.onTagFiltersChange(
							props.tagFilters,
							props.tagMode === "include" ? "exclude" : "include",
						)
					}
					onClearAll={() => props.onTagFiltersChange([], "include")}
					placeholder="添加标签过滤…"
				/>
			</div>

			<div class={styles.exportWrap}>
				<Button variant="secondary" size="sm" onClick={props.onExport}>
					导出
				</Button>
			</div>
		</div>
	);
}
