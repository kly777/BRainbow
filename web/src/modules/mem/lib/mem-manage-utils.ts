// ── 记忆管理模块的类型、常量和纯数据访问函数 ──

import type { MemItem, TagInfo } from "@modules/mem";
import { getAllMemsE } from "@modules/mem";
export type TagMode = "include" | "exclude";

// (类型原在 v1 MemManageToolbar，已上移至此)
import { notifyError, tryAsync } from "@shared/utils";

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

/** Badge 变量子集（与 components/ui/atoms/Badge 的变体对齐） */
export type MemBadgeVariant =
	| "default"
	| "new"
	| "learning"
	| "review"
	| "relearning"
	| "suspended"
	| "success"
	| "warning";

// ── 记忆状态元数据：中文标签 + 徽章变体（表格/详情共用，替代各处散落的 stateLabel） ──

export const MEM_STATE_META: Record<
	string,
	{ label: string; badge: MemBadgeVariant }
> = {
	new: { label: "新", badge: "new" },
	learning: { label: "学习", badge: "learning" },
	review: { label: "复习", badge: "review" },
	relearning: { label: "重学", badge: "relearning" },
	suspended: { label: "挂起", badge: "suspended" },
	buried: { label: "已埋葬", badge: "warning" },
	today_done: { label: "已复习", badge: "success" },
};

export function memStateMeta(state: string): {
	label: string;
	badge: MemBadgeVariant;
} {
	return MEM_STATE_META[state] ?? { label: state, badge: "default" };
}

// ── 纯数据获取 ──

export async function fetchAllMems(
	sortField: SortField,
	sortDir: SortDir,
	search: string,
	stateFilter: string,
	tagFilters: TagInfo[],
	tagMode: TagMode,
	page: number,
	id: number | null = null,
): Promise<{ items: MemItem[]; meta: PageMeta }> {
	const tagIds = tagFilters.map((t) => t.id).join(",");
	const result = await tryAsync(() =>
		getAllMemsE({
			sort: sortField,
			order: sortDir,
			q: search || undefined,
			state: stateFilter !== "all" ? stateFilter : undefined,
			id: id ?? undefined,
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
