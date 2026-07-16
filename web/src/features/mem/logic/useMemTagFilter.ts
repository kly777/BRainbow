// ── 标签过滤逻辑 ──

import { useSearchParams } from "@solidjs/router";
import { createMemo, createResource, createSignal } from "solid-js";
import { listTagsE, searchTagsE } from "../api.ts";
import type { TagInfo } from "../model.ts";

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
	const [searchParams, setSearchParams] = useSearchParams();
	const [allTags, setAllTags] = createSignal<TagInfo[]>([]);
	const [tagQuery, setTagQuery] = createSignal("");
	const [tagOpen, setTagOpen] = createSignal(false);

	// 首次加载所有标签
	listTagsE()
		.then(setAllTags)
		.catch(() => {});

	const tagFilterIds = () => {
		const v = searchParams.tag_ids;
		return typeof v === "string"
			? v.split(",").filter(Boolean).map(Number)
			: [];
	};

	const tagMode = (): "include" | "exclude" =>
		searchParams.tag_mode === "exclude" ? "exclude" : "include";

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
		setSearchParams({
			tag_ids: next.join(","),
			tag_mode: searchParams.tag_mode,
		});
		setTagQuery("");
		setTagOpen(false);
		setTimeout(loadDue, 0);
	};

	const removeTagFilter = (tagId: number) => {
		const next = tagFilterIds().filter((id) => id !== tagId);
		setSearchParams({
			tag_ids: next.length > 0 ? next.join(",") : undefined,
			tag_mode: searchParams.tag_mode,
		});
		setTimeout(loadDue, 0);
	};

	const toggleTagMode = () => {
		setSearchParams({
			tag_mode: tagMode() === "include" ? "exclude" : "include",
		});
		setTimeout(loadDue, 0);
	};

	const clearTagFilters = () => {
		setSearchParams({ tag_ids: undefined, tag_mode: undefined });
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
