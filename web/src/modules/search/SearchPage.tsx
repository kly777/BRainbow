import { PATHS } from "@config/paths";
import type { SearchHit } from "@modules/command-palette/api.ts";
import { searchE } from "@modules/command-palette/api.ts";
import {
	KIND_LABEL,
	resolveTargetUrl,
} from "@modules/command-palette/hooks/suggestions.ts";
import styles from "@modules/search/SearchPage.module.css";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createSignal, For, Show } from "solid-js";

const MODULES = [
	{ key: "all", label: "全部" },
	{ key: "mem", label: "记忆" },
	{ key: "card", label: "卡片" },
	{ key: "task", label: "任务" },
	{ key: "bookmark", label: "书签" },
	{ key: "onto", label: "本体" },
	{ key: "text", label: "文本" },
	{ key: "reading", label: "阅读" },
	{ key: "conv", label: "对话" },
	{ key: "chat", label: "AI 对话" },
	{ key: "file", label: "文件" },
];

function highlightKeywords(text: string, query: string): string {
	if (!query || !text) return "";
	const escaped = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	const terms = query.trim().split(/\s+/).filter(Boolean);
	let result = escaped;
	for (const term of terms) {
		const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
		result = result.replace(re, (m) => `<mark>${m}</mark>`);
	}
	return result;
}

export default function SearchPage() {
	const [params, setParams] = useSearchParams();
	const navigate = useNavigate();
	const [hits, setHits] = createSignal<SearchHit[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [filter, setFilter] = createSignal("all");

	const query = () => {
		const v = params.q;
		return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
	};

	createEffect(() => {
		const q = query();
		if (!q) {
			setHits([]);
			return;
		}
		setLoading(true);
		searchE(q, 20)
			.then((res) => setHits(res.hits))
			.catch(() => setHits([]))
			.finally(() => setLoading(false));
	});

	const filteredHits = () => {
		const f = filter();
		const all = hits();
		return f === "all" ? all : all.filter((h) => h.kind === f);
	};

	const handleSearch = (e: SubmitEvent) => {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const input = form.elements.namedItem("q") as HTMLInputElement;
		if (input.value.trim()) {
			setParams({ q: input.value.trim() });
		}
	};

	return (
		<div class={styles.page}>
			<h1 class="sr-only">全局搜索</h1>
			<form onSubmit={handleSearch} class={styles.form}>
				<input
					name="q"
					type="search"
					placeholder="搜索…"
					value={query()}
					class={styles.input}
				/>
			</form>

			<Show when={query()}>
				<div class={styles.filters}>
					<For each={MODULES}>
						{(mod) => (
							<button
								type="button"
								onClick={() => setFilter(mod.key)}
								class={`${styles["filter-btn"]}${filter() === mod.key ? ` ${styles["filter-btn-active"]}` : ""}`}
							>
								{mod.label}
							</button>
						)}
					</For>
				</div>

				<Show when={loading()}>
					<div class={styles.status}>搜索中…</div>
				</Show>

				<Show when={!loading() && filteredHits().length === 0}>
					<div class={styles.status}>未找到匹配结果</div>
				</Show>

				<div class={styles.results}>
					<For each={filteredHits()}>
						{(hit) => (
							<button
								type="button"
								onClick={() => navigate(resolveTargetUrl(hit.target))}
								class={styles.hit}
							>
								<span class={styles["hit-kind"]}>
									{KIND_LABEL[hit.kind] ?? hit.kind}
								</span>
								<div class={styles["hit-body"]}>
									<div class={styles["hit-title"]}>{hit.title}</div>
									<div
										class={styles["hit-snippet"]}
										innerHTML={highlightKeywords(hit.snippet, query())}
									/>
								</div>
							</button>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}
