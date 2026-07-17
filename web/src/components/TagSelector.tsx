import { createResource, createSignal, For, Show } from "solid-js";
import { createTagE, searchTagsE, type TagInfo } from "../features/mem/api.ts";
import styles from "./TagSelector.module.css";

interface Props {
	tags: TagInfo[];
	onAdd: (tag: TagInfo) => void;
	onRemove: (tagId: number) => void;
}

export default function TagSelector(props: Props) {
	const [query, setQuery] = createSignal("");
	const [open, setOpen] = createSignal(false);
	const [creating, setCreating] = createSignal(false);

	const [searchResults] = createResource(
		() => (query().trim().length > 0 ? query().trim() : null),
		(q) => searchTagsE(q),
	);

	const filteredSuggestions = () => {
		const q = query().toLowerCase().trim();
		if (!q) return [];
		const ownIds = new Set(props.tags.map((t) => t.id));
		return (searchResults() ?? []).filter((t) => !ownIds.has(t.id));
	};

	const hasExactMatch = () =>
		(searchResults() ?? []).some(
			(t) => t.name.toLowerCase() === query().toLowerCase().trim(),
		);

	const handleSelect = async (tag: TagInfo) => {
		props.onAdd(tag);
		setQuery("");
		setOpen(false);
	};

	const handleCreate = async () => {
		const name = query().trim();
		if (!name) return;
		setCreating(true);
		try {
			const tag = await createTagE(name);
			props.onAdd(tag);
			setQuery("");
			setOpen(false);
		} catch {
			/* toast handled globally */
		} finally {
			setCreating(false);
		}
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			const suggestions = filteredSuggestions();
			if (suggestions.length > 0) {
				handleSelect(suggestions[0]);
			} else if (!hasExactMatch() && query().trim()) {
				handleCreate();
			}
		}
		if (e.key === "Escape") {
			setOpen(false);
		}
	};

	return (
		<div class={styles.tagSelector}>
			<Show when={props.tags.length > 0}>
				<div class={styles.tags}>
					<For each={props.tags}>
						{(tag) => (
							<span class={styles.tag}>
								{tag.name}
								<button
									type="button"
									class={styles.tagRemove}
									onClick={() => props.onRemove(tag.id)}
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
					placeholder="搜索或创建标签…"
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
								onMouseDown={() => handleSelect(tag)}
							>
								{tag.name}
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
							onMouseDown={handleCreate}
						>
							{creating() ? "创建中…" : `+ 创建"${query().trim()}"`}
						</button>
					</Show>
				</div>
			</Show>
		</div>
	);
}
