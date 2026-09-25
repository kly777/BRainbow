// ── 标签过滤的 URL 持久化（tag_ids 规范 schema；tag_names 旧链接兼容迁移） ──

import { tryAsync } from "@shared/utils";
import { createSignal, onMount } from "solid-js";
import { listTagsE, searchTagsE, type TagInfo } from "../api.ts";
import type { TagMode } from "../lib/mem-manage-utils.ts";
import type { UseMemManageParamsResult } from "./useMemManageParams.ts";

export function useTagFiltersUrl(params: UseMemManageParamsResult) {
	const [tagFilters, setTagFiltersInternal] = createSignal<TagInfo[]>([]);

	// 挂载时按 URL 恢复 TagInfo 并做 tag_names → tag_ids 兼容迁移
	onMount(async () => {
		const ids = params.tagFilterIds();
		const legacyNames = params.tagFilterNames();

		// 旧链接兼容迁移：tag_names 有值而 tag_ids 为空 → 解析名称得 ids，回写 tag_ids 并清除 tag_names
		if (ids.length === 0 && legacyNames.length > 0) {
			const resolved: TagInfo[] = [];
			for (const name of legacyNames) {
				const result = await tryAsync(() => searchTagsE(name));
				if (result.ok) {
					const found = result.value.find((t: TagInfo) => t.name === name);
					if (found) resolved.push(found);
				}
			}
			setTagFiltersInternal(resolved);
			params.setSearchParams({
				tag_ids: resolved.map((t) => t.id).join(",") || undefined,
				tag_names: undefined,
				tag_mode: params.tagMode() === "exclude" ? "exclude" : undefined,
			});
			return;
		}

		// 标准路径：按 tag_ids 从全量标签解析 TagInfo 供展示
		if (ids.length === 0) return;
		const result = await tryAsync(() => listTagsE());
		if (!result.ok) return;
		const byId = new Map(result.value.map((t) => [t.id, t]));
		setTagFiltersInternal(
			ids
				.map((id) => byId.get(id))
				.filter((t): t is TagInfo => t !== undefined),
		);
	});

	const setTagFilters = (tags: TagInfo[], mode: TagMode) => {
		setTagFiltersInternal(tags);
		params.setSearchParams({
			tag_ids: tags.map((t) => t.id).join(",") || undefined,
			tag_mode: mode === "exclude" ? "exclude" : undefined,
		});
	};

	return { tagFilters, setTagFilters };
}
