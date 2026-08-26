// ── 标签过滤逻辑（URL 为唯一权威；输入/下拉交互在 TagPicker 组件内） ──

import {
	enumParam,
	listParam,
	notifyError,
	tryAsync,
	useUrlParams,
} from "@lib/utils";
import type { TagInfo } from "@modules/mem";
import { listTagsE } from "@modules/mem";
import { createMemo, createSignal } from "solid-js";

interface UseMemTagFilterResult {
	allTags: () => TagInfo[];
	tagFilterIds: () => number[];
	tagMode: () => "include" | "exclude";
	tagFilterTags: () => TagInfo[];
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

	const addTagFilter = (tag: TagInfo) => {
		if (tagFilterIds().includes(tag.id)) return;
		const next = [...tagFilterIds(), tag.id];
		params.set({ tag_ids: next.map(String), tag_mode: tagMode() });
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
		tagFilterIds,
		tagMode,
		tagFilterTags,
		addTagFilter,
		removeTagFilter,
		toggleTagMode,
		clearTagFilters,
	};
}
