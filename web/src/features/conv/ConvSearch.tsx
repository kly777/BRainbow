import { A, useNavigate } from "@solidjs/router";
import { createResource, createSignal, For, onMount, Show } from "solid-js";
import { strParam, useUrlParams } from "@lib/useUrlParams.ts";
import { type ConvHit, searchConvE } from "@features/conv/api.ts";
import styles from "@features/conv/ConvSearch.module.css";

const VALID_TABS = ["all", "conv", "article"] as const;
type Tab = (typeof VALID_TABS)[number];

const fieldLabel: Record<string, string> = {
	title: "标题",
	qa: "问答",
	article: "文章",
};

const typeLabel: Record<string, string> = {
	concept: "概念",
	solution: "方案",
	explanation: "解释",
	summary: "总结",
};

export default function ConvSearch() {
	const [query, setQuery] = createSignal("");
	const urlParams = useUrlParams({ q: strParam(""), t: strParam("") });
	const _navigate = useNavigate();

	// 从 URL 恢复 tab
	const tab = () => {
		const tv = urlParams.get("t");
		return VALID_TABS.includes(tv as Tab) ? (tv as Tab) : "all";
	};
	const setTab = (t: Tab) => {
		urlParams.set({ q: urlParams.get("q"), t: t === "all" ? "all" : t });
	};

	// 从 URL 恢复 query
	const searchQuery = () => urlParams.get("q");

	onMount(() => {
		const q = urlParams.get("q");
		if (q) {
			setQuery(q);
		}
	});

	const [data] = createResource(
		() => (searchQuery() ? `${searchQuery()}|${tab()}` : null),
		(key) => {
			if (!key) return { hits: [], total: 0 };
			const [q, t] = key.split("|");
			return searchConvE(q, t as Tab);
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
			return `/conv/concept/${hit.conv_id}?${params.toString()}`;
		}
		return `/conv/qa/${hit.conv_id}${suffix}`;
	};

	return (
		<div class={styles.page}>
			<div class={styles.topBar}>
				<A href="/" class={styles.backLink}>
					← 主页
				</A>
				<h1 class={styles.title}>对话搜索</h1>
			</div>

			<p class={styles.initialHint}>输入关键词，搜索 AI 对话历史、概念和方案</p>

			<form class={styles.searchBar} onSubmit={handleSearch}>
				<div class={styles.inputWrap}>
					<input
						class={styles.input}
						type="text"
						placeholder="搜索对话、文章、标签…"
						value={query()}
						onInput={(e) => setQuery(e.currentTarget.value)}
						autofocus
					/>
					<Show when={query()}>
						<button
							type="button"
							class={styles.clearBtn}
							onClick={() => {
								setQuery("");
							}}
						>
							×
						</button>
					</Show>
				</div>
				<button type="submit" class={styles.btn}>
					搜索
				</button>
			</form>

			<div class={styles.tabs}>
				<button
					type="button"
					class={tab() === "all" ? styles.tabActive : styles.tab}
					onClick={() => setTab("all")}
				>
					全部
				</button>
				<button
					type="button"
					class={tab() === "conv" ? styles.tabActive : styles.tab}
					onClick={() => setTab("conv")}
				>
					对话
				</button>
				<button
					type="button"
					class={tab() === "article" ? styles.tabActive : styles.tab}
					onClick={() => setTab("article")}
				>
					概念 / 方案
				</button>
			</div>

			<Show when={searchQuery()}>
				<div class={styles.summary}>
					搜索 "{searchQuery()}" — 共 {data().total} 条结果
				</div>
			</Show>

			<div class={styles.results}>
				<Show when={!searchQuery()}>
					<div class={styles.empty}>输入关键词搜索对话或文章</div>
				</Show>
				<Show when={data.loading}>
					<div class={styles.spinnerWrap}>
						<div class={styles.spinner} />
					</div>
				</Show>
				<For each={data().hits}>
					{(hit) => (
						<A href={itemHref(hit)} class={styles.item}>
							<div class={styles.itemTop}>
								<span class={styles.badge}>
									{fieldLabel[hit.match_field] || hit.match_field}
								</span>
								<span class={styles.tagType}>
									{typeLabel[hit.conv_type] || hit.conv_type}
								</span>
							</div>
							<div class={styles.itemTitle}>{hit.title}</div>
							<div class={styles.itemSnippet}>{hit.snippet}</div>
							<div class={styles.itemMeta}>{hit.created_at.slice(0, 10)}</div>
						</A>
					)}
				</For>
				<Show when={searchQuery() && !data.loading && data().hits.length === 0}>
					<div class={styles.empty}>没有找到匹配的结果</div>
				</Show>
			</div>
		</div>
	);
}
