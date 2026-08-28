import { X } from "@components/ui/icons";
// ── 标签选择器：chips + 搜索下拉 + 可选创建/过滤模式，mem 模块统一入口 ──
// 消费者：ManageDetail / MemExportModal / MemBatchTagModal（纯选择），
// ManageToolbar / FilterBar（过滤模式外观）。
// bookmark 的 TagInput 为名字键控领域变体，刻意不并入（模块隔离）。

import { Button } from "@components/ui";
import { createTagE, searchTagsE, type TagInfo } from "@modules/mem";
import { blurClose, trimmedQuery, tryAsync } from "@shared/utils";
import { createResource, createSignal, For, Show } from "solid-js";
import styles from "./TagPicker.module.css";

export interface TagPickerProps {
	selected: TagInfo[];
	onAdd: (tag: TagInfo) => void;
	onRemove: (tagId: number) => void;
	/** 无精确匹配时提供「创建标签」选项（点击与 Enter 均可触发） */
	allowCreate?: boolean;
	placeholder?: string;
	/** 过滤模式：传入时 chips 呈现包含/排除样式 */
	mode?: "include" | "exclude";
	onModeToggle?: () => void;
	onClearAll?: () => void;
	class?: string;
}

export default function TagPicker(props: TagPickerProps) {
	const [query, setQuery] = createSignal("");
	const [open, setOpen] = createSignal(false);
	const [creating, setCreating] = createSignal(false);

	const [searchResults] = createResource(trimmedQuery(query), (q) =>
		searchTagsE(q),
	);

	const ownIds = () => new Set(props.selected.map((t) => t.id));
	const suggestions = () =>
		(query().trim()
			? (searchResults() ?? []).filter((t) => !ownIds().has(t.id))
			: []) as TagInfo[];

	const hasExactMatch = () =>
		(searchResults() ?? []).some(
			(t) => t.name.toLowerCase() === query().toLowerCase().trim(),
		);

	const select = (tag: TagInfo) => {
		props.onAdd(tag);
		setQuery("");
		setOpen(false);
	};

	const handleCreate = async () => {
		const name = query().trim();
		if (!name) return;
		setCreating(true);
		const result = await tryAsync(() => createTagE(name));
		if (result.ok) {
			props.onAdd(result.value);
			setQuery("");
			setOpen(false);
		}
		// 失败 toast 由 request.ts 全局处理
		setCreating(false);
	};

	const showDropdown = () =>
		open() &&
		query().trim().length > 0 &&
		(suggestions().length > 0 ||
			(props.allowCreate === true && !hasExactMatch()));

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			const first = suggestions()[0];
			if (first) select(first);
			else if (props.allowCreate && !hasExactMatch() && query().trim()) {
				void handleCreate();
			}
		}
		if (e.key === "Escape") {
			setOpen(false);
		}
	};

	return (
		<div class={`${styles.picker}${props.class ? ` ${props.class}` : ""}`}>
			<Show when={props.onModeToggle}>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => props.onModeToggle?.()}
					title={props.mode === "include" ? "切换为排除模式" : "切换为包含模式"}
				>
					{props.mode === "include" ? "包含" : "排除"}
				</Button>
			</Show>

			<For each={props.selected}>
				{(tag) => (
					<span
						classList={{
							[styles.chip]: !props.mode,
							[styles.chipActive]: props.mode === "include",
							[styles.chipExcluded]: props.mode === "exclude",
						}}
					>
						{tag.name}
						<button
							type="button"
							class={styles.chipClear}
							onClick={() => props.onRemove(tag.id)}
							aria-label={`移除标签 ${tag.name}`}
							title="移除标签"
						>
							<X size={14} />
						</button>
					</span>
				)}
			</For>

			<Show when={props.onClearAll && props.selected.length > 0}>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => props.onClearAll?.()}
					title="清除全部标签"
				>
					清除
				</Button>
			</Show>

			<input
				type="text"
				class={styles.input}
				placeholder={props.placeholder ?? "搜索或添加标签…"}
				aria-label={props.placeholder ?? "搜索或添加标签"}
				value={query()}
				onInput={(e) => {
					setQuery(e.currentTarget.value);
					setOpen(true);
				}}
				onFocus={() => setOpen(true)}
				onBlur={blurClose(() => setOpen(false)).schedule}
				onKeyDown={handleKeyDown}
			/>

			<Show when={showDropdown()}>
				<div class={styles.dropdown}>
					<For each={suggestions()}>
						{(tag) => (
							<button
								type="button"
								class={styles.item}
								onMouseDown={() => select(tag)}
							>
								{tag.name}
							</button>
						)}
					</For>
					<Show when={props.allowCreate && !hasExactMatch()}>
						<button
							type="button"
							classList={{
								[styles.item]: true,
								[styles.createNew]: true,
							}}
							onMouseDown={() => void handleCreate()}
						>
							{creating() ? "创建中…" : `+ 创建"${query().trim()}"`}
						</button>
					</Show>
				</div>
			</Show>
		</div>
	);
}
