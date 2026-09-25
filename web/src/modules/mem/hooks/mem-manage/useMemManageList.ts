// ── 记忆列表的取数：查询参数快照 → createResource（含"直达定位"一次） ──
//
// 从 useMemManage 里切出来的一块。三条既有约定原样保留：
//   · source 不含 id：点详情不触发列表重载
//   · refetch 保留旧值：无闪烁（loading 只在首次无数据时为真）
//   · 直达（?id=xxx）首次请求传 id 定位页码，随后同步 URL 转入正常分页

import { createMemo, createResource, createSignal } from "solid-js";
import type { MemItem, TagInfo } from "../../api.ts";
import type {
	PageMeta,
	SortDir,
	SortField,
	TagMode,
} from "../../lib/mem-manage-utils.ts";
import { fetchAllMems } from "../../lib/mem-manage-utils.ts";
import type { MemManageParams } from "../useMemManageParams.ts";

/** 列表查询参数快照类型（不含 id） */
interface ListKey {
	q: string;
	state: string;
	sort: SortField;
	order: SortDir;
	page: number;
	tagMode: TagMode;
	tagFilters: TagInfo[];
}

// ── 初始 URL 的直达 id（组件挂载时读一次，仅用于直达定位） ──
function readInitialDetailId(): number | null {
	const raw = new URL(window.location.href).searchParams.get("id");
	if (!raw) return null;
	const n = Number(raw);
	return Number.isNaN(n) || n < 1 ? null : n;
}

export function useMemManageList(deps: {
	params: MemManageParams;
	tagFilters: () => TagInfo[];
}) {
	const { params } = deps;

	// ── 直达标记：初始 URL 有 id 时，首次请求传 id 定位页码 ──
	const [directId, setDirectId] = createSignal<number | null>(
		readInitialDetailId(),
	);

	// ── 列表查询参数快照（不含 id —— 点详情不重载列表） ──
	const listQuery = createMemo(
		(): ListKey => ({
			q: params.searchQuery(),
			state: params.filterState(),
			sort: params.sortField(),
			order: params.sortDir(),
			page: params.page(),
			tagMode: params.tagMode(),
			tagFilters: deps.tagFilters(),
		}),
	);

	// ── 列表资源：参数变化自动重取；refetch 时保留旧值（无闪烁） ──
	const [list, { refetch }] = createResource<
		{
			items: MemItem[];
			meta: PageMeta;
		},
		ListKey
	>(listQuery, async (key) => {
		const direct = directId();
		if (direct != null) {
			// 直达定位：page 固定 1，传 id；后端返回实际页数据 + meta.page
			const res = await fetchAllMems(
				key.sort as SortField,
				key.order,
				key.q,
				key.state,
				key.tagFilters,
				key.tagMode,
				1,
				direct,
			);
			// 定位完成：清除直达标记；若实际页 ≠ URL 页，同步 URL（触发静默 refetch，数据一致）
			setDirectId(null);
			if (res.meta.page !== key.page) {
				params.setSearchParams({ page: String(res.meta.page) });
			}
			params.restoreScrollPosition();
			return res;
		}
		const res = await fetchAllMems(
			key.sort as SortField,
			key.order,
			key.q,
			key.state,
			key.tagFilters,
			key.tagMode,
			key.page,
		);
		params.restoreScrollPosition();
		return res;
	});

	const mems = (): MemItem[] => list()?.items ?? [];
	const pageMeta = (): PageMeta =>
		list()?.meta ?? { page: 1, total_pages: 0, total: 0 };
	/** 仅首次无数据时显示 loading（refetch 保留旧值不闪） */
	const loading = () => list.loading && !list();

	return { list, refetch, mems, pageMeta, loading };
}

export type MemManageList = ReturnType<typeof useMemManageList>;
