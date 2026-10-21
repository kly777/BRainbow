import { Button, Input } from "@components/ui";
import styles from "@modules/search/SearchPage.module.css";
import { highlightKeywords } from "@shared/utils";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createSignal, For, Show } from "solid-js";
import {
	KIND_LABEL,
	resolveTargetUrl,
	type SearchHit,
	searchE,
} from "@modules/command-palette";

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

	const submitQuery = (value: string) => {
		const q = value.trim();
		if (q) setParams({ q });
	};

	const handleSearch = (e: SubmitEvent) => {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const input = form.elements.namedItem("q") as HTMLInputElement;
		submitQuery(input.value);
	};

	return (
		<div class={styles.page}>
			<h1 class={styles.title}>全局搜索</h1>
			<form onSubmit={handleSearch} class={styles.form}>
				<Input
					name="q"
					type="search"
					placeholder="搜索任务、卡片、记忆、文件…"
					value={query()}
					class={styles.input}
					aria-label="搜索"
					onKeyDown={(e) => {
						// 有些环境（含 IAB）对单输入框表单不触发隐式提交；
						// 显式接管 Enter，并跳过 IME 组字中的确认键。
						if (e.key === "Enter" && !e.isComposing) {
							e.preventDefault();
							submitQuery(e.currentTarget.value);
						}
					}}
				/>
				<Button type="submit" variant="primary">
					搜索
				</Button>
			</form>

			<Show when={!query()}>
				<div class={styles.status}>
					输入关键词，搜索任务、卡片、记忆、文件等全部内容
				</div>
			</Show>

			<Show when={query()}>
				<div class={styles.filters}>
					<For each={MODULES}>
						{(mod) => (
							<button
								type="button"
								onClick={() => setFilter(mod.key)}
								class={`${styles.filterBtn}${filter() === mod.key ? ` ${styles.filterBtnActive}` : ""}`}
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
								<span class={styles.hitKind}>
									{KIND_LABEL[hit.kind] ?? hit.kind}
								</span>
								<div class={styles.hitBody}>
									<div class={styles.hitTitle}>{hit.title}</div>
									<div
										class={styles.hitSnippet}
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
