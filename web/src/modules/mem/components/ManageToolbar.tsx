// ── v2 管理工具栏：搜索 / 标签过滤 / 状态筛选 / 导出 ──

import { Button, FilterGroup, SearchInput } from "@components/ui";
import { searchTagsE, type TagInfo } from "@modules/mem";
import { createResource, createSignal, For, Show } from "solid-js";
import styles from "./ManageToolbar.module.css";

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
	const [tagQuery, setTagQuery] = createSignal("");
	const [tagOpen, setTagOpen] = createSignal(false);

	const [searchResults] = createResource(
		() => (tagQuery().trim().length > 0 ? tagQuery().trim() : null),
		(q) => searchTagsE(q),
	);

	const ownIds = () => new Set(props.tagFilters.map((t) => t.id));

	const suggestions = () =>
		(tagQuery().trim()
			? (searchResults() ?? []).filter((t) => !ownIds().has(t.id))
			: []) as TagInfo[];

	const addTag = (tag: TagInfo) => {
		if (!ownIds().has(tag.id)) {
			props.onTagFiltersChange([...props.tagFilters, tag], props.tagMode);
		}
		setTagQuery("");
		setTagOpen(false);
	};

	const removeTag = (id: number) => {
		props.onTagFiltersChange(
			props.tagFilters.filter((t) => t.id !== id),
			props.tagMode,
		);
	};

	const toggleMode = () => {
		const newMode: TagMode =
			props.tagMode === "include" ? "exclude" : "include";
		props.onTagFiltersChange(props.tagFilters, newMode);
	};

	const clearAll = () => {
		props.onTagFiltersChange([], "include");
	};

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

			{/* 标签过滤 */}
			<div class={styles.tagFilter}>
				<Button
					variant="secondary"
					size="sm"
					onClick={toggleMode}
					title={
						props.tagMode === "include" ? "切换为排除模式" : "切换为包含模式"
					}
				>
					{props.tagMode === "include" ? "☐ 包含" : "☒ 排除"}
				</Button>
				<For each={props.tagFilters}>
					{(tag) => (
						<span
							class={
								props.tagMode === "include"
									? styles.activeTag
									: styles.excludedTag
							}
						>
							{tag.name}
							<button
								type="button"
								class={styles.tagClear}
								onClick={() => removeTag(tag.id)}
								aria-label={`移除标签 ${tag.name}`}
							>
								✕
							</button>
						</span>
					)}
				</For>
				<Show when={props.tagFilters.length > 0}>
					<Button
						variant="ghost"
						size="sm"
						onClick={clearAll}
						title="清除标签过滤"
					>
						清除
					</Button>
				</Show>
				<input
					type="text"
					class={styles.tagInput}
					placeholder="添加标签过滤…"
					aria-label="添加标签过滤"
					value={tagQuery()}
					onInput={(e) => {
						setTagQuery(e.currentTarget.value);
						setTagOpen(true);
					}}
					onFocus={() => setTagOpen(true)}
					onBlur={() => setTimeout(() => setTagOpen(false), 200)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && suggestions().length > 0) {
							addTag(suggestions()[0]);
						}
					}}
				/>
				<Show when={tagOpen() && suggestions().length > 0}>
					<div class={styles.tagDropdown}>
						{suggestions().map((tag) => (
							<button
								type="button"
								class={styles.tagOption}
								onMouseDown={() => addTag(tag)}
							>
								{tag.name}
							</button>
						))}
					</div>
				</Show>
			</div>

			<Button variant="secondary" size="sm" onClick={props.onExport}>
				导出
			</Button>

			{/* 状态筛选 */}
			<div class={styles.filterGroup}>
				<FilterGroup
					options={FILTER_OPTIONS}
					selected={props.filterState}
					onChange={props.onFilterChange}
				/>
			</div>
		</div>
	);
}
