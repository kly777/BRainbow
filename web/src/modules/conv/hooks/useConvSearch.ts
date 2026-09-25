import { PATHS } from "@config/paths";
import type { ConvHit } from "@modules/conv";
import { searchConvE } from "@modules/conv";
import { strParam, useListResource, useUrlParams } from "@shared/utils";
import type { Accessor } from "solid-js";

const VALID_TABS = ["all", "article"] as const;
export type ConvSearchTab = (typeof VALID_TABS)[number];

export interface ConvSearchApi {
	query: () => string;
	setQuery: (value: string) => void;
	tab: () => ConvSearchTab;
	setTab: (t: ConvSearchTab) => void;
	searchQuery: () => string;
	data: () => { hits: ConvHit[]; total: number };
	/** Accessor（不是值）：见 useListResource 的约定 1 */
	loading: Accessor<boolean>;
	error: Accessor<unknown>;
	handleSearch: (e: SubmitEvent) => void;
	itemHref: (hit: ConvHit) => string;
	/** 重新检索（错误态的重试入口用） */
	refetch: () => void;
}

export function useConvSearch(): ConvSearchApi {
	const urlParams = useUrlParams({ q: strParam(""), t: strParam("") });

	const query = () => urlParams.get("q");
	const setQuery = (value: string) =>
		urlParams.set({ q: value.trim() }, { replace: true });

	const tab = () => {
		const tv = urlParams.get("t");
		return VALID_TABS.includes(tv as ConvSearchTab)
			? (tv as ConvSearchTab)
			: "all";
	};
	const setTab = (t: ConvSearchTab) => {
		urlParams.set({ q: urlParams.get("q"), t });
	};

	const searchQuery = () => urlParams.get("q");

	// 检索结果走共享原语：空查询时不发请求（键为 null，fetcher 返回空页），
	// total 用接口给的（hits 可能被 limit 截断，不能拿长度当总数）
	const list = useListResource<{ q: string; t: ConvSearchTab } | null, ConvHit>(
		{
			key: () => (searchQuery() ? { q: searchQuery(), t: tab() } : null),
			fetcher: async (key) => {
				if (!key) return { items: [], page: 1, total: 0, total_pages: 0 };
				const r = await searchConvE(key.q, key.t);
				return { items: r.hits, page: 1, total: r.total, total_pages: 1 };
			},
		},
	);

	const handleSearch = (e: SubmitEvent) => {
		e.preventDefault();
		const q = query().trim();
		if (!q) return;
		urlParams.set({ q, t: tab() !== "all" ? tab() : "all" }, { replace: true });
	};

	const itemHref = (hit: ConvHit) => {
		const q = searchQuery();
		const t = tab();
		const params = new URLSearchParams();
		if (q) params.set("q", String(q));
		if (t !== "all") params.set("t", t);
		const qs = params.toString();
		const suffix = qs ? `?${qs}` : "";
		if (hit.match_field === "article" && hit.article_title) {
			params.set("article", hit.article_title);
			return `${PATHS.convConcept.replace(":id", String(hit.conv_id))}?${params.toString()}`;
		}
		return `${PATHS.convDetail.replace(":id", String(hit.conv_id))}${suffix}`;
	};

	return {
		query,
		setQuery,
		tab,
		setTab,
		searchQuery,
		data: () => ({ hits: list.items(), total: list.total() }),
		// Accessor（不是值）：见 useListResource 的约定 1
		loading: list.loading,
		error: list.error,
		handleSearch,
		itemHref,
		refetch: list.refetch,
	};
}
