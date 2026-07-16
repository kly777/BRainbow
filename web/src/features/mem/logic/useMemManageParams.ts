// ── URL 搜索参数管理 ──

import { useSearchParams } from "@solidjs/router";
import type { TagMode } from "../ui/MemManageToolbar.tsx";
import {
	type SortField,
	type SortDir,
	VALID_STATES,
	VALID_SORT_FIELDS,
} from "./mem-manage-utils.ts";

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
	const [searchParams, setSearchParams] = useSearchParams();

	const searchQuery = () => {
		const q = searchParams.q;
		return typeof q === "string" ? q : "";
	};

	const filterState = () => {
		const s = searchParams.state;
		return typeof s === "string" &&
			VALID_STATES.includes(s as (typeof VALID_STATES)[number])
			? s
			: "all";
	};

	const sortField = (): SortField => {
		const s = searchParams.sort;
		return typeof s === "string" && VALID_SORT_FIELDS.includes(s as SortField)
			? (s as SortField)
			: "due_at";
	};

	const sortDir = (): SortDir =>
		searchParams.order === "desc" ? "desc" : "asc";

	const page = () => {
		const p = Number(searchParams.page);
		return p > 0 ? p : 1;
	};

	const detailId = () => {
		const id = Number(searchParams.id);
		return id > 0 ? id : null;
	};

	const setDetailId = (id: number | null) =>
		setSearchParams({ id: id != null ? String(id) : undefined });

	const tagMode = (): TagMode =>
		searchParams.tag_mode === "exclude" ? "exclude" : "include";

	const tagFilterNames = () => {
		const v = searchParams.tag_names;
		return typeof v === "string" ? v.split(",").filter(Boolean) : [];
	};

	// ── 便捷操作 ──

	const handleSearchInput = (value: string) => {
		setSearchParams({ q: value || undefined, page: "1" });
	};

	const setFilter = (st: string) => {
		setSearchParams({ state: st === "all" ? undefined : st, page: "1" });
	};

	const toggleSort = (field: SortField) => {
		const params: Record<string, string | undefined> = { page: "1" };
		if (sortField() === field)
			params.order = sortDir() === "asc" ? "desc" : "asc";
		else {
			params.sort = field;
			params.order = "asc";
		}
		setSearchParams(params);
	};

	const goToPage = (p: number) => {
		setSearchParams({ page: p > 1 ? String(p) : undefined });
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
		setSearchParams,
		handleSearchInput,
		setFilter,
		toggleSort,
		goToPage,
	};
}
