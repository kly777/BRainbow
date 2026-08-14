// ── 标签过滤的 URL 持久化（tag_names / tag_mode query） ──

import { tryAsync } from "@lib/utils";
import { searchTagsE, type TagInfo } from "@modules/mem";
import { createSignal, onMount } from "solid-js";
import type { TagMode } from "../lib/mem-manage-utils.ts";
import type { UseMemManageParamsResult } from "./useMemManageParams.ts";

export function useTagFiltersUrl(params: UseMemManageParamsResult) {
	const [tagFilters, setTagFiltersInternal] = createSignal<TagInfo[]>([]);

	// 挂载时按 URL 中的标签名恢复 TagInfo（名称可能已失效，忽略即可）
	onMount(async () => {
		const names = params.tagFilterNames();
		if (names.length === 0) return;
		const all: TagInfo[] = [];
		for (const name of names) {
			const result = await tryAsync(() => searchTagsE(name));
			if (result.ok) {
				const found = result.value.find((t: TagInfo) => t.name === name);
				if (found) all.push(found);
			}
		}
		setTagFiltersInternal(all);
	});

	const setTagFilters = (tags: TagInfo[], mode: TagMode) => {
		setTagFiltersInternal(tags);
		params.setSearchParams({
			tag_names: tags.map((t) => t.name).join(",") || undefined,
			tag_mode: mode === "exclude" ? "exclude" : undefined,
		});
	};

	return { tagFilters, setTagFilters };
}
