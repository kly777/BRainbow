// ── /bookmark 的搜索：不闪烁的搜索态 ──
//
// 从 BookmarkPage 的页面体里抽出来的一段：页面此前自持 4 个信号（query /
// results / searching / error）并手写了一个 `searchSeq` 序号守卫来防竞态。
// 竞态守卫是 createResource 已经负责的事（见 shared/utils/useListResource.ts
// 文件头的"无需手写 loadSeq"），所以这里换成资源驱动，信号只留输入文本。
//
// 两条既有契约必须保持：
//   1. **不闪烁**：搜索中保留上一次的结果（页面只在首次搜索时给加载态，更新过程
//      只用「更新中…」提示），所以结果 accessor 会回落到 `resource.latest`；
//   2. **错误不抛给页面**：本应用没有 ErrorBoundary，fetcher 里抛错会让响应式更新
//      中断（项目里踩过 —— "页面永远停在骨架屏"），所以异常在 fetcher 内消化成
//      error 信号（与 useListResource / useDetailResource 同一处理）。

import { getErrorMessage } from "@shared/api";
import { tryAsync } from "@shared/utils";
import { createResource, createSignal } from "solid-js";
import { type Bookmark, searchBookmarksE } from "../api.ts";

/** 一次取够：分组视图的搜索没有分页入口 */
const SEARCH_PAGE_SIZE = 200;

export interface BookmarkSearchApi {
	/** 输入框里的文本（含首尾空白） */
	query: () => string;
	setQuery: (value: string) => void;
	/** 搜索结果；没有查询词时为 null（页面据此回到分组视图） */
	results: () => Bookmark[] | null;
	/** 正在取新结果（旧结果仍在，页面显示「更新中…」） */
	updating: () => boolean;
	error: () => string | null;
}

export function useBookmarkSearch(): BookmarkSearchApi {
	const [query, setQuery] = createSignal("");
	const [error, setError] = createSignal<unknown>(null);
	const trimmed = () => query().trim();

	const [results] = createResource(
		() => (trimmed() ? trimmed() : null),
		async (q) => {
			const result = await tryAsync(() =>
				searchBookmarksE(q, 1, SEARCH_PAGE_SIZE),
			);
			if (result.ok) {
				setError(null);
				return result.value;
			}
			setError(result.error);
			return undefined;
		},
	);

	const items = (): Bookmark[] | null => {
		// 没有查询词 → 分组视图；取数中或失败 → 上一次的结果（不闪烁契约）
		if (!trimmed()) return null;
		return results()?.items ?? results.latest?.items ?? null;
	};

	return {
		query,
		setQuery,
		results: items,
		// 首次搜索（还没有任何结果）时不算"更新中"：那时页面本来就该给加载态
		updating: () => results.loading && items() !== null,
		error: () => (error() ? getErrorMessage(error()) : null),
	};
}
