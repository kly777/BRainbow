// ── 命令面板站内搜索 ──
// 从 usePalette 拆分：防抖搜索请求 + 竞态保护 + 结果映射。

import { SEARCH_DEBOUNCE_MS } from "@shared/utils";
import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup } from "solid-js";
import type { SearchHit } from "../api.ts";
import { searchE } from "../api.ts";
import { buildSearchItems, searchWeb } from "./suggestions.ts";
import type { Mode, Suggestion } from "./usePalette.ts";

export interface UsePaletteSearchOpts {
	mode: Accessor<Mode>;
	query: Accessor<string>;
	navigate: (path: string) => void;
	close: () => void;
}

export function usePaletteSearch(opts: UsePaletteSearchOpts) {
	const [hits, setHits] = createSignal<SearchHit[]>([]);
	const [searching, setSearching] = createSignal(false);

	const searchItems = (): Suggestion[] =>
		opts.mode() === "search"
			? buildSearchItems(
					hits(),
					opts.query().trim(),
					searching(),
					opts.navigate,
					opts.close,
				)
			: [];

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
		if (query) searchWeb(query);
	};

	return {
		hits,
		searching,
		searchItems,
		fallbackSearch,
	};
}
