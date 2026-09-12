/**
 * 文件标签输入：已选标签 chips + 建议下拉（基于现有文件标签，本地过滤）。
 * 按名称工作，Enter 直接添加（保存时后端自动创建）。
 * 与 bookmark 的 TagInput 同构，但 file 后端无标签删除/搜索接口，故省略
 * 全局删除与远程搜索，直接对全部标签做本地过滤。
 */

import { Input } from "@components/ui";
import { blurClose } from "@shared/utils";
import {
	type Component,
	createMemo,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import { type FileTag, listFileTags } from "../api.ts";
import styles from "./TagInput.module.css";

interface Props {
	tags: string[];
	onAdd: (name: string) => void;
	onRemove: (name: string) => void;
}

const TagItem: Component<{ name: string; onRemove: (name: string) => void }> = (
	props,
) => (
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

export default function TagInput(props: Props) {
	const [query, setQuery] = createSignal("");
	const [open, setOpen] = createSignal(false);
	const [tags] = createResource<FileTag[]>(() => listFileTags());

	const trimmed = () => query().trim();

	const filteredSuggestions = createMemo(() => {
		const q = trimmed().toLowerCase();
		if (!q) return [];
		const own = new Set(props.tags);
		return (tags() ?? []).filter(
			(t) => !own.has(t.name) && t.name.toLowerCase().includes(q),
		);
	});

	const hasExactMatch = () =>
		(tags() ?? []).some(
			(t) => t.name.toLowerCase() === trimmed().toLowerCase(),
		);

	const handleAdd = () => {
		const name = trimmed();
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
				<Input
					class={styles.input}
					placeholder="添加标签（Enter 确认，可创建新标签）…"
					value={query()}
					onInput={(e) => {
						setQuery(e.currentTarget.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onBlur={blurClose(() => setOpen(false)).schedule}
					onKeyDown={handleKeyDown}
					aria-label="添加标签"
				/>
			</div>
			<Show when={open() && trimmed().length > 0}>
				<div class={styles.dropdown}>
					<For each={filteredSuggestions()}>
						{(tag) => (
							<button
								type="button"
								class={styles.dropdownItem}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => {
									props.onAdd(tag.name);
									setQuery("");
									setOpen(false);
								}}
							>
								<span class={styles.dropdownName}>{tag.name}</span>
							</button>
						)}
					</For>
					<Show when={!hasExactMatch() && trimmed().length > 0}>
						<button
							type="button"
							classList={{
								[styles.dropdownItem]: true,
								[styles.createNew]: true,
							}}
							onMouseDown={handleAdd}
						>
							+ 使用"{trimmed()}"
						</button>
					</Show>
				</div>
			</Show>
		</div>
	);
}
