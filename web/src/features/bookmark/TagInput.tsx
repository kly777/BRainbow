/**
 * 书签标签输入：已选标签 chips + 建议下拉（基于现有标签搜索）。
 * 按名称工作，Enter 直接添加（保存时后端自动创建）。
 */
import { createResource, createSignal, For, Show } from "solid-js";
import { searchBookmarkTagsE } from "@features/bookmark/api.ts";
import * as styles from "@features/bookmark/TagInput.css.ts";

interface Props {
	tags: string[];
	onAdd: (name: string) => void;
	onRemove: (name: string) => void;
}

export default function TagInput(props: Props) {
	const [query, setQuery] = createSignal("");
	const [open, setOpen] = createSignal(false);

	const [searchResults] = createResource(
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

	return (
		<div class={styles.tagInput}>
			<Show when={props.tags.length > 0}>
				<div class={styles.tags}>
					<For each={props.tags}>
						{(name) => (
							<span class={styles.tag}>
								{name}
								<button
									type="button"
									class={styles.tagRemove}
									onClick={() => props.onRemove(name)}
									title="移除标签"
								>
									×
								</button>
							</span>
						)}
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
					onBlur={() => setTimeout(() => setOpen(false), 200)}
					onKeyDown={handleKeyDown}
				/>
			</div>
			<Show when={open() && query().trim().length > 0}>
				<div class={styles.dropdown}>
					<For each={filteredSuggestions()}>
						{(tag) => (
							<button
								type="button"
								class={styles.dropdownItem}
								onMouseDown={() => {
									props.onAdd(tag.name);
									setQuery("");
									setOpen(false);
								}}
							>
								{tag.name}
								<span class={styles.dropdownCount}>{tag.count}</span>
							</button>
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
