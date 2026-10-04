// ── 文件列表的筛选/分页/视图参数（URL 是唯一来源） ──
//
// 从 useFileList 里切出来的第一块：这一整块只做"URL 参数 ↔ 语义化访问器"的翻译，
// 与取数、上传、批量操作无关。

import { enumParam, numParam, strParam, useUrlParams } from "@shared/utils";
import type { FileCategoryFilter, SortOrder } from "../../api.ts";
import { CATEGORIES } from "../../lib/category.ts";

/**
 * 分类筛选的全部取值：`""`（全部）+ 五个真实分类。
 *
 * 五个真实分类从 `lib/category.ts` 的 `CATEGORY_LABEL` 派生 —— 那张表是
 * `Record<FileCategory, string>`，新增一个分类时它会编译失败逼着人补，
 * 这里跟着自动长出来。原先这里另抄了一份字面量清单，与 api 的 `FileCategory`、
 * `FileList.tsx` 的 `CATEGORY_TABS` 是三份互不相关的抄写。
 */
const CATEGORY_FILTERS: readonly FileCategoryFilter[] = ["", ...CATEGORIES];

const SORT_ORDERS = [
	"created_desc",
	"created_asc",
	"size_desc",
	"size_asc",
	"name_asc",
	"name_desc",
] as const satisfies readonly SortOrder[];

/** 列表视图模式 */
export type FileView = "grid" | "list";

export function useFileListParams() {
	const params = useUrlParams({
		// category 走 enumParam：URL 里手写的分类（拼错、大小写不同）一律退回"全部"，
		// 与改造前 `VALID_CATEGORIES.includes(...)` 的行为一致，但取值清单只有一份
		category: enumParam(CATEGORY_FILTERS, ""),
		tag: strParam(""),
		q: strParam(""),
		sort: strParam("created_desc"),
		view: strParam("grid"),
		page: numParam(1, { min: 1 }),
	});

	const category = (): FileCategoryFilter => params.get("category");
	// 筛选变化一律回到第 1 页，否则可能停在一个不存在的页码上
	const setCategory = (t: FileCategoryFilter) =>
		params.set({ category: t, page: 1 });
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
