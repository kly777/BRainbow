import { createSignal, createResource, Show, For, onMount } from "solid-js";
import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { request } from "../apis/request.ts";
import styles from "./ConvSearch.module.css";

interface ConvHit {
	conv_id: number;
	title: string;
	conv_type: string;
	snippet: string;
	match_field: string;
	created_at: string;
	score: number;
	article_title?: string;
}

interface SearchResponse {
	hits: ConvHit[];
	total: number;
}

type Tab = "all" | "conv" | "article";

function searchConv(q: string, tab: Tab): Promise<SearchResponse> {
	return request(`/conv/search?q=${encodeURIComponent(q)}&limit=50&search_type=${tab}`);
}

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
	const [searchQuery, setSearchQuery] = createSignal("");
	const [tab, setTab] = createSignal<Tab>("all");
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();

	onMount(() => {
		const urlQ = searchParams.q;
		if (urlQ && typeof urlQ === "string") {
			setQuery(urlQ);
			setSearchQuery(urlQ);
		}
	});

	const [data] = createResource(
		() => searchQuery() ? `${searchQuery()}|${tab()}` : null,
		(key) => {
			if (!key) return { hits: [], total: 0 };
			const [q, t] = key.split("|");
			return searchConv(q, t as Tab);
		},
		{ initialValue: { hits: [], total: 0 } },
	);

	const handleSearch = (e: SubmitEvent) => {
		e.preventDefault();
		const q = query().trim();
		if (!q) return;
		setSearchQuery(q);
		navigate(`/conv?q=${encodeURIComponent(q)}`, { replace: true });
	};

	const itemHref = (hit: ConvHit) => {
		if (hit.match_field === "article" && hit.article_title) {
			return `/conv/concept/${hit.conv_id}?article=${encodeURIComponent(hit.article_title)}`;
		}
		return `/conv/qa/${hit.conv_id}`;
	};

	return (
		<div class={styles.page}>
			<div class={styles.topBar}>
				<A href="/" class={styles.backLink}>← 主页</A>
				<h1 class={styles.title}>对话搜索</h1>
			</div>

			<p class={styles.initialHint}>输入关键词，搜索 AI 对话历史、概念和方案</p>

			<form class={styles.searchBar} onSubmit={handleSearch}>
				<input
					class={styles.input}
					type="text"
					placeholder="搜索对话、文章、标签…"
					value={query()}
					onInput={(e) => setQuery(e.currentTarget.value)}
					autofocus
				/>
				<button type="submit" class={styles.btn}>搜索</button>
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
				<For each={data().hits}>
					{(hit) => (
						<A href={itemHref(hit)} class={styles.item}>
							<div class={styles.itemTop}>
								<span class={styles.badge}>{fieldLabel[hit.match_field] || hit.match_field}</span>
								<span class={styles.tagType}>{typeLabel[hit.conv_type] || hit.conv_type}</span>
							</div>
							<div class={styles.itemTitle}>{hit.title}</div>
							<div class={styles.itemSnippet}>{hit.snippet}</div>
							<div class={styles.itemMeta}>{hit.created_at.slice(0, 10)}</div>
						</A>
					)}
				</For>
				<Show when={searchQuery() && data().hits.length === 0}>
					<div class={styles.empty}>没有找到匹配的结果</div>
				</Show>
			</div>
		</div>
	);
}
