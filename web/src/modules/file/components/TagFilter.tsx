/**
 * 文件标签筛选下拉：列出所有标签供选择，可本地搜索。
 * 与 bookmark 的 TagFilter 同构，但 file 标签接口无计数，省略数量显示。
 */

import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { type FileTag, listFileTags } from "../api.ts";
import styles from "./TagFilter.module.css";

interface Props {
	value: string;
	onChange: (tag: string) => void;
}

export default function TagFilter(props: Props) {
	const [open, setOpen] = createSignal(false);
	const [query, setQuery] = createSignal("");
	const [tags] = createResource<FileTag[]>(() => listFileTags());

	const filteredTags = createMemo(() => {
		const q = query().trim().toLowerCase();
		const all = tags() ?? [];
		if (!q) return all;
		return all.filter((t) => t.name.toLowerCase().includes(q));
	});

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
				<span class={styles.triggerLabel}>
					{props.value ? `标签：${props.value}` : "全部标签"}
				</span>
				<span class={styles.triggerArrow}>{open() ? "▴" : "▾"}</span>
			</button>
			<Show when={open()}>
				<div class={styles.dropdown}>
					<div class={styles.searchWrap}>
						<input
							type="text"
							class={styles.searchInput}
							placeholder="搜索标签…"
							value={query()}
							onInput={(e) => setQuery(e.currentTarget.value)}
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
						{(tag: FileTag) => (
							<button
								type="button"
								class={`${styles.option} ${props.value === tag.name ? styles.optionActive : ""}`}
								onClick={() => select(tag.name)}
							>
								<span class={styles.optionName}>{tag.name}</span>
							</button>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}
