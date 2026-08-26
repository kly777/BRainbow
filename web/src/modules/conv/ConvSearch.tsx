import { Button, FilterGroup, SearchInput } from "@components/ui";
import { PATHS } from "@config/paths";
import { getErrorMessage } from "@shared/api";
import { fmtLocal } from "@shared/utils";
import { A } from "@solidjs/router";
import { For, Show } from "solid-js";
import styles from "./ConvSearch.module.css";
import { useConvSearch } from "./hooks/useConvSearch.ts";

const fieldLabel: Record<string, string> = {
	title: "标题",
	article: "文章",
};

const typeLabel: Record<string, string> = {
	concept: "概念",
	solution: "方案",
	explanation: "解释",
	summary: "总结",
};

export default function ConvSearch() {
	const m = useConvSearch();

	return (
		<div class={styles.page}>
			<div class={styles.topBar}>
				<A href={PATHS.home} class={styles.backLink}>
					← 主页
				</A>
				<h1 class={styles.title}>知识搜索</h1>
			</div>

			<p class={styles.initialHint}>输入关键词，搜索概念与文章</p>

			<form class={styles.searchBar} onSubmit={m.handleSearch}>
				<SearchInput
					class={styles.input}
					placeholder="搜索概念、文章…"
					value={m.query()}
					onSearch={m.setQuery}
				/>
				<Button type="submit" variant="primary">
					搜索
				</Button>
			</form>

			<FilterGroup
				options={[
					{ value: "all", label: "全部" },
					{ value: "article", label: "概念 / 方案" },
				]}
				selected={m.tab()}
				onChange={(t) => m.setTab(t as "all" | "article")}
			/>

			<Show when={m.searchQuery()}>
				<div class={styles.summary}>
					搜索 "{m.searchQuery()}" — 共 {m.data().total} 条结果
				</div>
			</Show>

			<div class={styles.results}>
				<Show when={!m.searchQuery()}>
					<div class={styles.empty}>输入关键词搜索概念或文章</div>
				</Show>
				<Show when={m.loading}>
					<div class={styles.spinnerWrap}>
						<div class={styles.spinner} />
					</div>
				</Show>
				<Show
					when={m.error}
					fallback={
						<>
							<For each={m.data().hits}>
								{(hit) => (
									<A href={m.itemHref(hit)} class={styles.item}>
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
										<div class={styles.itemMeta}>
											{fmtLocal(hit.created_at)}
										</div>
									</A>
								)}
							</For>
							<Show
								when={
									m.searchQuery() && !m.loading && m.data().hits.length === 0
								}
							>
								<div class={styles.empty}>没有找到匹配的结果</div>
							</Show>
						</>
					}
				>
					<div class={styles.errorMsg}>{getErrorMessage(m.error)}</div>
				</Show>
			</div>
		</div>
	);
}
