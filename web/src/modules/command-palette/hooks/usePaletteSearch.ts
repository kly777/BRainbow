// ── 命令面板站内搜索 ──
// 从 usePalette 拆分：防抖搜索请求 + 竞态保护 + 结果映射 + 搜索历史。

import { SEARCH_DEBOUNCE_MS } from "@shared/utils";
import {
	addToSearchHistory,
	clearSearchHistory,
	getSearchHistory,
} from "@shared/utils/search-history.ts";
import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup } from "solid-js";
import type { SearchHit } from "../api.ts";
import { searchE } from "../api.ts";
import { buildSearchItems, searchWeb } from "./suggestions.ts";
import type { Mode, Suggestion } from "./usePalette.ts";

const EMPTY: Suggestion[] = [];

export interface UsePaletteSearchOpts {
	mode: Accessor<Mode>;
	query: Accessor<string>;
	setQuery: (v: string) => void;
	navigate: (path: string) => void;
	close: () => void;
}

export function usePaletteSearch(opts: UsePaletteSearchOpts) {
	const [hits, setHits] = createSignal<SearchHit[]>([]);
	const [searching, setSearching] = createSignal(false);

	/** 搜索历史建议：在搜索模式且无输入时展示 */
	const historyItems = (): Suggestion[] => {
		if (opts.mode() !== "search" || opts.query().trim()) return EMPTY;
		const history = getSearchHistory();
		if (history.length === 0) return EMPTY;
		const items: Suggestion[] = history.map((q) => ({
			label: q,
			desc: "搜索历史",
			extra: "history",
			onSelect: () => {
				opts.setQuery(`?${q}`);
			},
		}));
		items.push({
			label: "清除搜索历史",
			desc: "移除所有历史记录",
			extra: "",
			onSelect: () => {
				clearSearchHistory();
			},
		});
		return items;
	};

	const searchItems = (): Suggestion[] => {
		if (opts.mode() !== "search") return EMPTY;
		const q = opts.query().trim();
		if (!q) return historyItems();
		return buildSearchItems(hits(), q, searching(), opts.navigate, opts.close);
	};

	// 防抖搜索 + 竞态保护
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let searchSeq = 0;

	createEffect(() => {
		if (opts.mode() !== "search") return;
		const q = opts.query().trim();
		clearTimeout(searchTimer);
		if (!q) {
			setHits([]);
			setSearching(false);
			return;
		}
		const seq = ++searchSeq;
		setHits([]);
		setSearching(true);
		searchTimer = setTimeout(async () => {
			try {
				const res = await searchE(q);
				if (seq === searchSeq) setHits(res.hits.slice(0, 24));
				// 搜索成功后保存到历史
				if (seq === searchSeq && res.hits.length > 0) {
					addToSearchHistory(q);
				}
			} catch {
				if (seq === searchSeq) setHits([]);
			} finally {
				if (seq === searchSeq) setSearching(false);
			}
		}, SEARCH_DEBOUNCE_MS);
	});

	onCleanup(() => clearTimeout(searchTimer));

	/** 搜索无结果时回退到外部搜索 */
	const fallbackSearch = (query: string) => {
		if (query) {
			addToSearchHistory(query);
			searchWeb(query);
		}
	};

	return {
		hits,
		searching,
		searchItems,
		fallbackSearch,
	};
}
