/**
 * 标签过滤下拉：列出所有标签（带数量）+ "无标签" 选项。
 * 用于管理页面按标签筛选书签。
 */

import type { BookmarkTagWithCount } from "@modules/bookmark";
import { searchBookmarkTagsE } from "@modules/bookmark";
import { createResource, createSignal, For, Show } from "solid-js";
import styles from "./TagFilter.module.css";

interface Props {
	value: string;
	onChange: (tag: string) => void;
}

const UNTAGGED = "__untagged__";

export default function TagFilter(props: Props) {
	const [open, setOpen] = createSignal(false);
	const [tags] = createResource(() => searchBookmarkTagsE(""));

	const displayLabel = () => {
		if (!props.value) return "全部标签";
		if (props.value === UNTAGGED) return "无标签";
		return props.value;
	};

	return (
		<div class={styles.wrapper}>
			<button
				type="button"
				class={styles.trigger}
				onClick={() => setOpen((v) => !v)}
			>
				<span class={styles.triggerLabel}>{displayLabel()}</span>
				<span class={styles.triggerArrow}>{open() ? "▴" : "▾"}</span>
			</button>
			<Show when={open()}>
				<div class={styles.dropdown}>
					<button
						type="button"
						class={`${styles.option} ${props.value === "" ? styles.optionActive : ""}`}
						onClick={() => {
							props.onChange("");
							setOpen(false);
						}}
					>
						全部标签
					</button>
					<div class={styles.divider} />
					<For each={tags() ?? []}>
						{(tag: BookmarkTagWithCount) => (
							<button
								type="button"
								class={`${styles.option} ${props.value === tag.name ? styles.optionActive : ""}`}
								onClick={() => {
									props.onChange(tag.name);
									setOpen(false);
								}}
							>
								<span class={styles.optionName}>{tag.name}</span>
								<span class={styles.optionCount}>{tag.count}</span>
							</button>
						)}
					</For>
					<div class={styles.divider} />
					<button
						type="button"
						class={`${styles.option} ${props.value === UNTAGGED ? styles.optionActive : ""}`}
						onClick={() => {
							props.onChange(UNTAGGED);
							setOpen(false);
						}}
					>
						<span class={styles.optionName}>无标签</span>
					</button>
				</div>
			</Show>
		</div>
	);
}
