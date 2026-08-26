// ── v2 标签过滤栏：外壳 + TagPicker（模式切换/chips/清空由 picker 承担） ──

import { Show } from "solid-js";
import type { UseMemReview } from "../hooks/useMemReviewTypes.ts";
import styles from "./FilterBar.module.css";
import TagPicker from "./TagPicker.tsx";

interface FilterBarProps {
	m: UseMemReview;
}

export default function FilterBar(props: FilterBarProps) {
	const { m } = props;

	return (
		<Show when={m.allTags().length > 0 || m.estimatedTotal() > 0}>
			<div class={styles.filterBar}>
				<TagPicker
					selected={m.tagFilterTags()}
					onAdd={m.addTagFilter}
					onRemove={m.removeTagFilter}
					mode={m.tagMode()}
					onModeToggle={m.toggleTagMode}
					onClearAll={m.clearTagFilters}
					placeholder="添加标签过滤…"
				/>
			</div>
		</Show>
	);
}
