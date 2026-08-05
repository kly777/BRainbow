// ── 记忆管理模块的类型、常量和纯数据访问函数 ──

import { getAllMemsE } from "@features/mem/api.ts";
import type { MemItem, TagInfo } from "@features/mem/model.ts";
export type TagMode = "include" | "exclude";
// (类型原在 v1 MemManageToolbar，已上移至此)
import { tryAsync, unwrapOr } from "@lib/result.ts";
import { notifyError } from "@lib/notify.ts";

// ── 类型 ──

export type SortField = "cue.created_at" | "difficulty" | "due_at" | "state";
export type SortDir = "asc" | "desc";

export interface PageMeta {
	page: number;
	total_pages: number;
	total: number;
}

// ── 常量 ──

export const VALID_STATES = [
	"all",
	"new",
	"learning",
	"review",
	"relearning",
	"suspended",
	"buried",
	"today_done",
] as const;

export const VALID_SORT_FIELDS: SortField[] = [
	"cue.created_at",
	"difficulty",
	"due_at",
	"state",
];

// ── 纯数据获取 ──

export async function fetchAllMems(
	sortField: SortField,
	sortDir: SortDir,
	search: string,
	stateFilter: string,
	tagFilters: TagInfo[],
	tagMode: TagMode,
	page: number,
): Promise<{ items: MemItem[]; meta: PageMeta }> {
	const tagIds = tagFilters.map((t) => t.id).join(",");
	const result = await tryAsync(() =>
		getAllMemsE({
			sort: sortField,
			order: sortDir,
			q: search || undefined,
			state: stateFilter !== "all" ? stateFilter : undefined,
			tag_ids: tagMode === "include" ? tagIds || undefined : undefined,
			exclude_tag_ids: tagMode === "exclude" ? tagIds || undefined : undefined,
			page,
			page_size: 50,
		}),
	);

	if (result.ok) {
		const res = result.value;
		return {
			items: res.items,
			meta: { page: res.page, total_pages: res.total_pages, total: res.total },
		};
	}

	notifyError("获取记忆列表失败", result.error);
	return { items: [], meta: { page: 1, total_pages: 0, total: 0 } };
}
