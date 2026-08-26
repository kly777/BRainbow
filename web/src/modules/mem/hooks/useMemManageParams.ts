// ── URL 搜索参数管理 ──
//
// 单一职责：所有列表/详情状态都从 URL 查询参数读写，URL 是唯一权威状态源。
// - q / state / sort / order / page / tag_mode / tag_names → 列表查询
// - id → 当前详情（直达/选中）
//
// 所有写入统一走 useUrlParams → setSearchParams（router 单一机制），
// 不混用 history.replaceState，避免状态漂移。

import {
	enumParam,
	listParam,
	numParam,
	strParam,
	useUrlParams,
} from "@shared/utils";
import type { TagMode } from "../lib/mem-manage-utils.ts";
import {
	type SortDir,
	type SortField,
	VALID_SORT_FIELDS,
	VALID_STATES,
} from "../lib/mem-manage-utils.ts";

export interface UseMemManageParamsResult {
	searchQuery: () => string;
	filterState: () => string;
	sortField: () => SortField;
	sortDir: () => SortDir;
	page: () => number;
	/** 当前详情 id（URL ?id=，缺失返回 null） */
	detailId: () => number | null;
	/** 设置/清除详情 id（null 或 undefined 从 URL 移除） */
	setDetailId: (id: number | null) => void;
	tagMode: () => TagMode;
	tagFilterNames: () => string[];
	setSearchParams: (params: Record<string, string | undefined>) => void;
	handleSearchInput: (value: string) => void;
	setFilter: (state: string) => void;
	toggleSort: (field: SortField) => void;
	/** 翻页：一次调用设置 page 并清除 id（详情随翻页失效） */
	goToPage: (p: number) => void;
}

export function useMemManageParams(): UseMemManageParamsResult {
	const params = useUrlParams({
		q: strParam(""),
		state: enumParam(VALID_STATES, "all"),
		sort: enumParam(VALID_SORT_FIELDS, "due_at"),
		order: enumParam(["asc", "desc"] as const, "asc"),
		page: numParam(1, { min: 1 }),
		id: numParam(0, { min: 1 }),
		tag_mode: enumParam(["include", "exclude"] as const, "include"),
		tag_names: listParam(),
	});

	const searchQuery = () => params.get("q");
	const filterState = () => params.get("state");
	const sortField = () => params.get("sort");
	const sortDir = (): SortDir => params.get("order");
	const page = () => params.get("page");

	const detailId = () => {
		const id = params.get("id");
		return id > 0 ? id : null;
	};
	const setDetailId = (id: number | null) =>
		params.set({ id: id ?? undefined });

	const tagMode = (): TagMode => params.get("tag_mode");
	const tagFilterNames = () => params.get("tag_names");

	// ── 便捷操作 ──

	const handleSearchInput = (value: string) => {
		params.set({ q: value, page: 1 });
	};

	const setFilter = (st: string) => {
		params.set({ state: st as (typeof VALID_STATES)[number], page: 1 });
	};

	const toggleSort = (field: SortField) => {
		if (sortField() === field) {
			params.set({ order: sortDir() === "asc" ? "desc" : "asc", page: 1 });
		} else {
			params.set({ sort: field, order: "asc", page: 1 });
		}
	};

	const goToPage = (p: number) => {
		// 换页时详情失效：一次调用同时设置 page 并清除 id
		params.set({ page: p, id: undefined });
	};

	return {
		searchQuery,
		filterState,
		sortField,
		sortDir,
		page,
		detailId,
		setDetailId,
		tagMode,
		tagFilterNames,
		setSearchParams: params.setSearchParams,
		handleSearchInput,
		setFilter,
		toggleSort,
		goToPage,
	};
}
