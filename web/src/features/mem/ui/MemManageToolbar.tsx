import { createResource, createSignal, For, Show } from "solid-js";
import { searchTagsE, type TagInfo } from "../../../apis/memApi.ts";
import Button from "../../../components/ui/Button.tsx";
import FilterGroup from "../../../components/ui/FilterGroup.tsx";
import SearchInput from "../../../components/ui/SearchInput.tsx";
import styles from "./MemManageToolbar.module.css";

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

export default function MemManageToolbar(props: Props) {
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
			<SearchInput
				value={props.searchQuery}
				onSearch={props.onSearch}
				placeholder="搜索线索或答案…"
			/>

			{/* 标签过滤 */}
			<div class={styles.tagFilter}>
				<button
					type="button"
					class={styles.modeToggle}
					onClick={toggleMode}
					title={
						props.tagMode === "include" ? "切换为排除模式" : "切换为包含模式"
					}
				>
					{props.tagMode === "include" ? "☐ 包含" : "☒ 排除"}
				</button>
				<div class={styles.tagList}>
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
								>
									x
								</button>
							</span>
						)}
					</For>
					<Show when={props.tagFilters.length > 0}>
						<button
							type="button"
							class={styles.clearAllBtn}
							onClick={clearAll}
							title="清除标签过滤"
						>
							清除
						</button>
					</Show>
				</div>
				<input
					type="text"
					class={styles.tagInput}
					placeholder="添加标签过滤…"
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

			<Button variant="ghost" size="sm" onClick={props.onExport}>
				导出
			</Button>
			<FilterGroup
				options={FILTER_OPTIONS}
				selected={props.filterState}
				onChange={props.onFilterChange}
			/>
		</div>
	);
}
