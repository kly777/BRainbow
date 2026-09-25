// ── DB 浏览器的 URL 参数层（唯一来源） ──
//
// 从 useDbViewer 里切出来的第一块：整张表的查询状态（表名/页码/页大小/引用过滤/
// 排序/列筛选）都住在 URL 上，这里只做"URL ↔ 语义化访问器"的翻译。
// `params` 句柄一并对外暴露：翻页/跳转这类操作本质就是"改 URL"，由调用方直接写。

import {
	numParam,
	strParam,
	type UrlParamReader,
	useUrlParams,
} from "@shared/utils";
import {
	type ColumnFilter,
	filtersFromParams,
	PAGE_SIZES,
} from "../../tableConfig.ts";

/**
 * db 专用多值参数 reader：兼容旧链接（重复参数 fcol=a&fcol=b）与新格式（逗号分隔），
 * 保留空槽位（fval 与 fop/fcol 对齐，"null" 类操作的空值依赖它）。
 */
function arrayParam(): UrlParamReader<string[]> {
	return {
		read: (raw) => {
			const value: unknown = raw;
			if (typeof value === "string") return value.split(",");
			if (Array.isArray(value)) {
				return value.filter((x): x is string => typeof x === "string");
			}
			return [];
		},
		write: (vs) => (vs.length === 0 ? undefined : vs.join(",")),
	};
}

export function useDbViewerParams() {
	const params = useUrlParams({
		table: strParam(""),
		page: numParam(1, { min: 1 }),
		page_size: numParam(50, { min: 1 }),
		id: numParam(0, { min: 1 }),
		ref_col: strParam("id"),
		sort: strParam(""),
		order: strParam(""),
		fcol: arrayParam(),
		fop: arrayParam(),
		fval: arrayParam(),
	});

	const activeTable = () => params.get("table");
	const currentPage = () => params.get("page");
	const currentPageSize = () => {
		const raw = params.get("page_size");
		return PAGE_SIZES.some((size) => size === raw) ? raw : 50;
	};
	const filterId = () => params.get("id");
	const filterCol = () => params.get("ref_col");
	const sortCol = () => params.get("sort");
	const sortDesc = () => params.get("order") === "desc";
	const filters = (): ColumnFilter[] =>
		filtersFromParams(
			params.get("fcol"),
			params.get("fop"),
			params.get("fval"),
		);
	const refFilter = () =>
		filterId() > 0 ? { col: filterCol(), id: filterId() } : null;

	return {
		params,
		activeTable,
		currentPage,
		currentPageSize,
		filterId,
		filterCol,
		sortCol,
		sortDesc,
		filters,
		refFilter,
	};
}

export type DbViewerParams = ReturnType<typeof useDbViewerParams>;
