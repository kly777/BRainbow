/**
 * 书签标签输入：已选标签 chips + 建议下拉（基于现有标签搜索）。
 * 按名称工作，Enter 直接添加（保存时后端自动创建）。
 * 建议下拉中可 hover 删除已存在的标签（全局删除，所有书签移除该标签）。
 */

import {
	blurClose,
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@lib/utils";
import type { BookmarkTagWithCount } from "@modules/bookmark";
import { deleteBookmarkTagE, searchBookmarkTagsE } from "@modules/bookmark";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import styles from "./TagInput.module.css";

interface Props {
	tags: string[];
	onAdd: (name: string) => void;
	onRemove: (name: string) => void;
	/** 标签被全局删除后通知父组件刷新列表 */
	onTagDeleted?: () => void;
}

interface TagItemProps {
	name: string;
	onRemove: (name: string) => void;
}

const TagItem: Component<TagItemProps> = (props) => (
	<span class={styles.tag}>
		{props.name}
		<button
			type="button"
			class={styles.tagRemove}
			onClick={() => props.onRemove(props.name)}
			title="移除标签"
		>
			×
		</button>
	</span>
);

interface SuggestionItemProps {
	tag: BookmarkTagWithCount;
	onSelect: () => void;
	onDelete: () => void;
}

const SuggestionItem: Component<SuggestionItemProps> = (props) => (
	<div class={styles.dropdownItem}>
		<button
			type="button"
			class={styles.dropdownSelect}
			onMouseDown={(e) => e.preventDefault()}
			onClick={props.onSelect}
		>
			<span class={styles.dropdownName}>{props.tag.name}</span>
			<span class={styles.dropdownCount}>{props.tag.count}</span>
		</button>
		<button
			type="button"
			class={styles.dropdownDelete}
			title={`删除标签「${props.tag.name}」`}
			onMouseDown={(e) => e.stopPropagation()}
			onClick={(e) => {
				e.preventDefault();
				e.stopPropagation();
				props.onDelete();
			}}
		>
			×
		</button>
	</div>
);

export default function TagInput(props: Props) {
	const [query, setQuery] = createSignal("");
	const [open, setOpen] = createSignal(false);

	const [searchResults, { refetch }] = createResource(
		() => (query().trim().length > 0 ? query().trim() : null),
		(q) => searchBookmarkTagsE(q),
	);

	const filteredSuggestions = () => {
		const q = query().toLowerCase().trim();
		if (!q) return [];
		const own = new Set(props.tags);
		return (searchResults() ?? []).filter((t) => !own.has(t.name));
	};

	const hasExactMatch = () =>
		(searchResults() ?? []).some(
			(t) => t.name.toLowerCase() === query().toLowerCase().trim(),
		);

	const handleAdd = () => {
		const name = query().trim();
		if (!name) return;
		props.onAdd(name);
		setQuery("");
		setOpen(false);
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			const suggestions = filteredSuggestions();
			if (suggestions.length > 0 && !hasExactMatch()) {
				props.onAdd(suggestions[0].name);
				setQuery("");
				setOpen(false);
			} else {
				handleAdd();
			}
		}
		if (e.key === "Escape") {
			setOpen(false);
		}
	};

	const handleDeleteTag = async (tag: BookmarkTagWithCount) => {
		setOpen(false);
		const confirmed = await showConfirm({
			title: "删除标签",
			message: `确定要删除标签「${tag.name}」吗？所有书签都会移除该标签。`,
			variant: "danger",
		});
		if (!confirmed) return;

		const result = await tryAsync(() => deleteBookmarkTagE(tag.id));
		if (result.ok) {
			notifySuccess("标签已删除");
			refetch();
			props.onTagDeleted?.();
		} else {
			notifyError("删除失败", result.error);
		}
	};

	return (
		<div class={styles.tagInput}>
			<Show when={props.tags.length > 0}>
				<div class={styles.tags}>
					<For each={props.tags}>
						{(name) => <TagItem name={name} onRemove={props.onRemove} />}
					</For>
				</div>
			</Show>
			<div class={styles.inputRow}>
				<input
					type="text"
					class={styles.input}
					placeholder="添加标签（Enter 确认，可创建新标签）…"
					value={query()}
					onInput={(e) => {
						setQuery(e.currentTarget.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onBlur={blurClose(() => setOpen(false))}
					onKeyDown={handleKeyDown}
				/>
			</div>
			<Show when={open() && query().trim().length > 0}>
				<div class={styles.dropdown}>
					<For each={filteredSuggestions()}>
						{(tag) => (
							<SuggestionItem
								tag={tag}
								onSelect={() => {
									props.onAdd(tag.name);
									setQuery("");
									setOpen(false);
								}}
								onDelete={() => handleDeleteTag(tag)}
							/>
						)}
					</For>
					<Show when={!hasExactMatch() && query().trim().length > 0}>
						<button
							type="button"
							classList={{
								[styles.dropdownItem]: true,
								[styles.createNew]: true,
							}}
							onMouseDown={handleAdd}
						>
							+ 使用"{query().trim()}"
						</button>
					</Show>
				</div>
			</Show>
		</div>
	);
}
