import { PATHS } from "@config/paths";
import type { ConvHit } from "@modules/conv";
import { searchConvE } from "@modules/conv";
import { strParam, useUrlParams } from "@shared/utils";
import { createResource } from "solid-js";

const VALID_TABS = ["all", "article"] as const;
export type ConvSearchTab = (typeof VALID_TABS)[number];

export interface ConvSearchApi {
	query: () => string;
	setQuery: (value: string) => void;
	tab: () => ConvSearchTab;
	setTab: (t: ConvSearchTab) => void;
	searchQuery: () => string;
	data: () => { hits: ConvHit[]; total: number };
	loading: boolean;
	error: Error | undefined;
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

	const [data, { refetch }] = createResource(
		() => (searchQuery() ? `${searchQuery()}|${tab()}` : null),
		(key) => {
			if (!key) return { hits: [], total: 0 };
			const [q, t] = key.split("|");
			return searchConvE(q, t as ConvSearchTab);
		},
		{ initialValue: { hits: [], total: 0 } },
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
		data: () => data(),
		// getter：快照会在 createResource 创建/刷新瞬间冻结旧值，
		// 导致 <Show when={loading}> 加载态永不更新（与 useFileList 同源修复）
		get loading() {
			return data.loading;
		},
		get error() {
			return data.error;
		},
		handleSearch,
		itemHref,
		refetch,
	};
}
