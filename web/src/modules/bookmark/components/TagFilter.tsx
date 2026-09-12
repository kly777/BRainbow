/**
 * 标签过滤下拉：搜索框 + 列出所有标签（带数量）+ "无标签" 选项。
 * 用于管理页面按标签筛选书签。
 */

import { Input } from "@components/ui";
import type { BookmarkTagWithCount } from "@modules/bookmark";
import { searchBookmarkTagsE } from "@modules/bookmark";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import styles from "./TagFilter.module.css";

interface Props {
	value: string;
	onChange: (tag: string) => void;
}

const UNTAGGED = "__untagged__";

export default function TagFilter(props: Props) {
	const [open, setOpen] = createSignal(false);
	const [query, setQuery] = createSignal("");
	const [tags] = createResource(() => searchBookmarkTagsE(""));

	const filteredTags = createMemo(() => {
		const q = query().trim().toLowerCase();
		const all = tags() ?? [];
		if (!q) return all;
		return all.filter((t) => t.name.toLowerCase().includes(q));
	});

	const displayLabel = () => {
		if (!props.value) return "全部标签";
		if (props.value === UNTAGGED) return "无标签";
		return props.value;
	};

	const select = (tag: string) => {
		props.onChange(tag);
		setOpen(false);
		setQuery("");
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
					<div class={styles.searchWrap}>
						<Input
							class={styles.searchInput}
							placeholder="搜索标签…"
							value={query()}
							onInput={(e) => setQuery(e.currentTarget.value)}
							aria-label="搜索标签"
							tone="bg"
						/>
					</div>
					<button
						type="button"
						class={`${styles.option} ${props.value === "" ? styles.optionActive : ""}`}
						onClick={() => select("")}
					>
						全部标签
					</button>
					<div class={styles.divider} />
					<For
						each={filteredTags()}
						fallback={
							<Show when={query().trim()}>
								<div class={styles.empty}>没有匹配的标签</div>
							</Show>
						}
					>
						{(tag: BookmarkTagWithCount) => (
							<button
								type="button"
								class={`${styles.option} ${props.value === tag.name ? styles.optionActive : ""}`}
								onClick={() => select(tag.name)}
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
						onClick={() => select(UNTAGGED)}
					>
						<span class={styles.optionName}>无标签</span>
					</button>
				</div>
			</Show>
		</div>
	);
}
