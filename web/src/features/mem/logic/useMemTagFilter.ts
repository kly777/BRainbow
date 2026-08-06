// ── 标签过滤逻辑 ──

import { createMemo, createResource, createSignal } from "solid-js";
import { enumParam, listParam, useUrlParams } from "@lib/useUrlParams.ts";
import { listTagsE, searchTagsE } from "@features/mem/api.ts";
import { notifyError } from "@lib/notify.ts";
import { tryAsync } from "@lib/result.ts";
import type { TagInfo } from "@features/mem/model.ts";

interface UseMemTagFilterResult {
	allTags: () => TagInfo[];
	tagQuery: () => string;
	setTagQuery: (v: string) => void;
	tagOpen: () => boolean;
	setTagOpen: (v: boolean) => void;
	tagFilterIds: () => number[];
	tagMode: () => "include" | "exclude";
	tagFilterTags: () => TagInfo[];
	tagSuggestions: () => TagInfo[];
	addTagFilter: (tag: TagInfo) => void;
	removeTagFilter: (tagId: number) => void;
	toggleTagMode: () => void;
	clearTagFilters: () => void;
}

export function useMemTagFilter(loadDue: () => void): UseMemTagFilterResult {
	const params = useUrlParams({
		tag_ids: listParam(),
		tag_mode: enumParam(["include", "exclude"] as const, "include"),
	});
	const [allTags, setAllTags] = createSignal<TagInfo[]>([]);
	const [tagQuery, setTagQuery] = createSignal("");
	const [tagOpen, setTagOpen] = createSignal(false);

	// 首次加载所有标签
	(async () => {
		const result = await tryAsync(() => listTagsE());
		if (result.ok) setAllTags(result.value);
		else notifyError("加载标签列表失败", result.error);
	})();

	const tagFilterIds = () => params.get("tag_ids").map(Number);

	const tagMode = (): "include" | "exclude" => params.get("tag_mode");

	const tagFilterTags = createMemo(() =>
		allTags().filter((t) => tagFilterIds().includes(t.id)),
	);

	const [tagSearchResults] = createResource(
		() => (tagQuery().trim().length > 0 ? tagQuery().trim() : null),
		(q) => searchTagsE(q),
	);

	const tagSuggestions = () =>
		(tagQuery().trim()
			? (tagSearchResults() ?? []).filter((t) => !tagFilterIds().includes(t.id))
			: []) as TagInfo[];

	const addTagFilter = (tag: TagInfo) => {
		const next = [...tagFilterIds(), tag.id];
		params.set({ tag_ids: next.map(String), tag_mode: tagMode() });
		setTagQuery("");
		setTagOpen(false);
		setTimeout(loadDue, 0);
	};

	const removeTagFilter = (tagId: number) => {
		const next = tagFilterIds().filter((id) => id !== tagId);
		params.set({ tag_ids: next.map(String), tag_mode: tagMode() });
		setTimeout(loadDue, 0);
	};

	const toggleTagMode = () => {
		params.set({ tag_mode: tagMode() === "include" ? "exclude" : "include" });
		setTimeout(loadDue, 0);
	};

	const clearTagFilters = () => {
		params.set({ tag_ids: [], tag_mode: "include" });
		setTimeout(loadDue, 0);
	};

	return {
		allTags,
		tagQuery,
		setTagQuery,
		tagOpen,
		setTagOpen,
		tagFilterIds,
		tagMode,
		tagFilterTags,
		tagSuggestions,
		addTagFilter,
		removeTagFilter,
		toggleTagMode,
		clearTagFilters,
	};
}
