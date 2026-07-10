import { createResource, createSignal, Show } from "solid-js";
import { searchTagsE, type TagInfo } from "../../apis/memApi.ts";
import Button from "../ui/Button.tsx";
import FilterGroup from "../ui/FilterGroup.tsx";
import SearchInput from "../ui/SearchInput.tsx";
import styles from "./MemManageToolbar.module.css";

interface Props {
	searchQuery: string;
	filterState: string;
	onSearch: (value: string) => void;
	onFilterChange: (state: string) => void;
	onExport: () => void;
	tagFilter: TagInfo | null;
	onTagFilterChange: (tag: TagInfo | null) => void;
}

const FILTER_OPTIONS = [
	{ value: "all", label: "全部" },
	{ value: "new", label: "新" },
	{ value: "learning", label: "学习" },
	{ value: "review", label: "复习" },
	{ value: "relearning", label: "重学" },
	{ value: "suspended", label: "挂起" },
	{ value: "today_done", label: "已复习" },
];

export default function MemManageToolbar(props: Props) {
	const [tagQuery, setTagQuery] = createSignal("");
	const [tagOpen, setTagOpen] = createSignal(false);

	const [searchResults] = createResource(
		() => (tagQuery().trim().length > 0 ? tagQuery().trim() : null),
		(q) => searchTagsE(q),
	);

	const suggestions = () =>
		(tagQuery().trim()
			? (searchResults() ?? []).filter(
					(t) => !props.tagFilter || t.id !== props.tagFilter.id,
				)
			: []) as TagInfo[];

	return (
		<div class={styles.toolbar}>
			<SearchInput
				value={props.searchQuery}
				onSearch={props.onSearch}
				placeholder="搜索线索或答案…"
			/>

			{/* 标签过滤 */}
			<div class={styles.tagFilter}>
				<Show when={props.tagFilter}>
					<span class={styles.activeTag}>
						{props.tagFilter!.name}
						<button
							type="button"
							class={styles.tagClear}
							onClick={() => {
								props.onTagFilterChange(null);
								setTagQuery("");
							}}
						>
							×
						</button>
					</span>
				</Show>
				<Show when={!props.tagFilter}>
					<input
						type="text"
						class={styles.tagInput}
						placeholder="标签过滤…"
						value={tagQuery()}
						onInput={(e) => {
							setTagQuery(e.currentTarget.value);
							setTagOpen(true);
						}}
						onFocus={() => setTagOpen(true)}
						onBlur={() => setTimeout(() => setTagOpen(false), 200)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && suggestions().length > 0) {
								props.onTagFilterChange(suggestions()[0]);
								setTagQuery("");
								setTagOpen(false);
							}
						}}
					/>
				</Show>
				<Show when={tagOpen() && suggestions().length > 0 && !props.tagFilter}>
					<div class={styles.tagDropdown}>
						{suggestions().map((tag) => (
							<div
								class={styles.tagOption}
								role="button"
								tabIndex={-1}
								onMouseDown={() => {
									props.onTagFilterChange(tag);
									setTagQuery("");
									setTagOpen(false);
								}}
							>
								{tag.name}
							</div>
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
