// ── v2 标签过滤栏 ──

import { For, Show } from "solid-js";
import type { UseMemReview } from "../../logic/useMemReview.ts";
import * as styles from "./V2FilterBar.css.ts";

interface V2FilterBarProps {
	m: UseMemReview;
}

export default function V2FilterBar(props: V2FilterBarProps) {
	const { m } = props;

	return (
		<Show when={m.allTags().length > 0 || m.estimatedTotal() > 0}>
			<div class={styles.filterBar}>
				<button
					type="button"
					class={styles.tagModeBtn}
					onClick={m.toggleTagMode}
					title={m.tagMode() === "include" ? "切换为排除模式" : "切换为包含模式"}
				>
					{m.tagMode() === "include" ? "☐ 包含" : "☒ 排除"}
				</button>

				<For each={m.tagFilterTags()}>
					{(tag) => (
						<span
							class={
								m.tagMode() === "include"
									? styles.tagChipActive
									: styles.tagChipExcluded
							}
						>
							{tag.name}
							<button
								type="button"
								class={styles.tagClear}
								onClick={() => m.removeTagFilter(tag.id)}
							>
								✕
							</button>
						</span>
					)}
				</For>

				<Show when={m.tagFilterTags().length > 0}>
					<button
						type="button"
						class={styles.tagClearAll}
						onClick={m.clearTagFilters}
					>
						清除
					</button>
				</Show>

				<input
					type="text"
					class={styles.tagSearchInput}
					placeholder="添加标签过滤…"
					value={m.tagQuery()}
					onInput={(e) => {
						m.setTagQuery(e.currentTarget.value);
						m.setTagOpen(true);
					}}
					onFocus={() => m.setTagOpen(true)}
					onBlur={() => setTimeout(() => m.setTagOpen(false), 200)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && m.tagSuggestions().length > 0) {
							m.addTagFilter(m.tagSuggestions()[0]);
						}
					}}
				/>

				<Show when={m.tagOpen() && m.tagSuggestions().length > 0}>
					<div class={styles.tagDropdown}>
						{m.tagSuggestions().map((t) => (
							<button
								type="button"
								class={styles.tagOption}
								tabIndex={-1}
								onMouseDown={() => m.addTagFilter(t)}
							>
								{t.name}
							</button>
						))}
					</div>
				</Show>
			</div>
		</Show>
	);
}
