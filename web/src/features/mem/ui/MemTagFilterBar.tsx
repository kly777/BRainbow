// ── 复习页面标签过滤栏 ──

import { For, Show } from "solid-js";
import type { UseMemReview } from "../logic/useMemReview.ts";
import styles from "../MemPage.module.css";

interface MemTagFilterBarProps {
	m: UseMemReview;
}

export default function MemTagFilterBar(props: MemTagFilterBarProps) {
	const { m } = props;

	return (
		<Show when={m.allTags().length > 0 || m.estimatedTotal() > 0}>
			<div class={styles.tagFilterBar}>
				<button
					type="button"
					class={styles.tagModeBtn}
					onClick={m.toggleTagMode}
					title={
						m.tagMode() === "include" ? "切换为排除模式" : "切换为包含模式"
					}
				>
					{m.tagMode() === "include" ? "☐ 包含" : "☒ 排除"}
				</button>

				<For each={m.tagFilterTags()}>
					{(tag) => (
						<span
							class={
								m.tagMode() === "include"
									? styles.tagFilterChipActive
									: styles.tagFilterChipExcluded
							}
						>
							{tag.name}
							<button
								type="button"
								class={styles.tagClear}
								onClick={() => m.removeTagFilter(tag.id)}
							>
								x
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

				<Show when={m.estimatedTotal() > 0}>
					<span class={styles.progressText}>
						≈ {m.estimatedTotal()} 次学习
						<Show when={m.estRemaining() >= 60}>
							· ~{Math.round(m.estRemaining() / 60)}m
						</Show>
						<Show when={m.estRemaining() > 0 && m.estRemaining() < 60}>
							· ~{m.estRemaining()}s
						</Show>
					</span>
				</Show>
			</div>
		</Show>
	);
}
