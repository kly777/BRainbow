// ── 记忆管理模块的类型、常量和纯数据访问函数 ──

import { getAllMemsE } from "../api.ts";
import type { MemItem, TagInfo } from "../model.ts";
import type { TagMode } from "../ui/MemManageToolbar.tsx";

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
	try {
		const tagIds = tagFilters.map((t) => t.id).join(",");
		const res = await getAllMemsE({
			sort: sortField,
			order: sortDir,
			q: search || undefined,
			state: stateFilter !== "all" ? stateFilter : undefined,
			tag_ids: tagMode === "include" ? tagIds || undefined : undefined,
			exclude_tag_ids: tagMode === "exclude" ? tagIds || undefined : undefined,
			page,
			page_size: 50,
		});
		return {
			items: res.items,
			meta: { page: res.page, total_pages: res.total_pages, total: res.total },
		};
	} catch (e: unknown) {
		console.error("获取记忆列表失败:", e);
		return { items: [], meta: { page: 1, total_pages: 0, total: 0 } };
	}
}
