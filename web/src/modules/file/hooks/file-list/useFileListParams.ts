// ── 文件列表的筛选/分页/视图参数（URL 是唯一来源） ──
//
// 从 useFileList 里切出来的第一块：这一整块只做"URL 参数 ↔ 语义化访问器"的翻译，
// 与取数、上传、批量操作无关。

import { numParam, strParam, useUrlParams } from "@shared/utils";
import type { SortOrder } from "../../api.ts";

const VALID_CATEGORIES = ["", "image", "video", "audio", "document", "other"];

const SORT_ORDERS = [
	"created_desc",
	"created_asc",
	"size_desc",
	"size_asc",
	"name_asc",
	"name_desc",
] as const;

/** 列表视图模式 */
export type FileView = "grid" | "list";

export function useFileListParams() {
	const params = useUrlParams({
		category: strParam(""),
		tag: strParam(""),
		q: strParam(""),
		sort: strParam("created_desc"),
		view: strParam("grid"),
		page: numParam(1, { min: 1 }),
	});

	const category = () =>
		VALID_CATEGORIES.includes(params.get("category"))
			? params.get("category")
			: "";
	// 筛选变化一律回到第 1 页，否则可能停在一个不存在的页码上
	const setCategory = (t: string) => params.set({ category: t, page: 1 });
	const tag = () => params.get("tag") || "";
	const setTag = (t: string) => params.set({ tag: t, page: 1 });
	const search = () => params.get("q") || "";
	const setSearch = (q: string) => params.set({ q, page: 1 });
	const page = () => params.get("page");

	const sort = (): SortOrder => {
		const value = params.get("sort");
		return (SORT_ORDERS as readonly string[]).includes(value)
			? (value as SortOrder)
			: "created_desc";
	};
	/** 排序变化回到第 1 页 */
	const setSort = (value: SortOrder) => params.set({ sort: value, page: 1 });

	/** 视图模式：网格（缩略图优先）/ 列表（信息密度优先） */
	const view = (): FileView =>
		params.get("view") === "list" ? "list" : "grid";
	const setView = (value: FileView) => params.set({ view: value });

	const goPage = (p: number) => params.set({ page: p });

	/** 上传成功后清掉筛选并回到第 1 页：否则新文件"看不到" */
	const resetFilters = () =>
		params.set({ category: "", tag: "", q: "", page: 1 });

	return {
		category,
		setCategory,
		tag,
		setTag,
		search,
		setSearch,
		sort,
		setSort,
		view,
		setView,
		page,
		goPage,
		resetFilters,
	};
}

export type FileListParams = ReturnType<typeof useFileListParams>;
