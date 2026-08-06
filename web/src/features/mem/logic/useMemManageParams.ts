// ── URL 搜索参数管理 ──

import {
	enumParam,
	numParam,
	listParam,
	strParam,
	useUrlParams,
} from "@lib/useUrlParams.ts";
import type { TagMode } from "@features/mem/logic/mem-manage-utils.ts";
import {
	type SortDir,
	type SortField,
	VALID_SORT_FIELDS,
	VALID_STATES,
} from "@features/mem/logic/mem-manage-utils.ts";

export interface UseMemManageParamsResult {
	searchQuery: () => string;
	filterState: () => string;
	sortField: () => SortField;
	sortDir: () => SortDir;
	page: () => number;
	detailId: () => number | null;
	setDetailId: (id: number | null) => void;
	tagMode: () => TagMode;
	tagFilterNames: () => string[];
	setSearchParams: (params: Record<string, string | undefined>) => void;
	handleSearchInput: (value: string) => void;
	setFilter: (state: string) => void;
	toggleSort: (field: SortField) => void;
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
		params.set({ id: id ?? 0 });

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
		params.set({ page: p });
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
