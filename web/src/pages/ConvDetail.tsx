import { A, useParams, useSearchParams } from "@solidjs/router";
import { createResource, For, Show } from "solid-js";
import { getConvDetailE } from "../apis/convApi.ts";
import MarkdownRenderer from "../components/ui/Markdown.tsx";
import styles from "./ConvDetail.module.css";

const typeLabel: Record<string, string> = {
	concept: "概念",
	solution: "方案",
	explanation: "解释",
	summary: "总结",
};

export default function ConvDetailPage() {
	const params = useParams();
	const [searchParams] = useSearchParams();
	const id = () => params.id;
	const articleOnly = () => searchParams.mode === "article";

	const [data] = createResource(id, (id) => getConvDetailE(Number(id)));

	const backHref = () => {
		const params = new URLSearchParams();
		const q = searchParams.q;
		const t = searchParams.t;
		if (q) params.set("q", String(q));
		if (t && t !== "all") params.set("t", String(t));
		const qs = params.toString();
		return qs ? `/conv?${qs}` : "/conv";
	};

	return (
		<div class={styles.page}>
			<Show when={data()} fallback={<div class={styles.loading}>加载中…</div>}>
				{(d) => (
					<>
						<div class={styles.topBar}>
							<A href={backHref()} class={styles.backLink}>
								← 搜索
							</A>
							<div class={styles.titleArea}>
								<h1 class={styles.title}>{d().title}</h1>
								<span class={styles.tag}>
									{typeLabel[d().conv_type] || d().conv_type}
								</span>
								<span class={styles.date}>{d().created_at.slice(0, 10)}</span>
							</div>
						</div>

						<div class={styles.body}>
							<Show when={!articleOnly()}>
								<div class={styles.qaSection}>
									<h2 class={styles.sectionTitle}>对话记录</h2>
									<For each={d().qa_pairs}>
										{(qa) => (
											<div class={styles.qaBlock}>
												<div class={styles.question}>
													<span class={styles.qLabel}>Q</span>
													<div class={styles.md}>
														<MarkdownRenderer content={qa.question} />
													</div>
												</div>
												<div class={styles.answer}>
													<span class={styles.aLabel}>A</span>
													<div class={styles.md}>
														<MarkdownRenderer content={qa.answer} />
													</div>
												</div>
											</div>
										)}
									</For>
								</div>
							</Show>

							<Show when={d().articles.length > 0}>
								<div class={styles.articleSection}>
									<h2 class={styles.sectionTitle}>总结 / 概念</h2>
									<For each={d().articles}>
										{(art) => (
											<div class={styles.articleBlock}>
												<h3 class={styles.articleTitle}>
													<span class={styles.artTag}>
														{typeLabel[art.article_type] || art.article_type}
													</span>
													{art.title}
												</h3>
												<div class={styles.md}>
													<MarkdownRenderer content={art.content} />
												</div>
											</div>
										)}
									</For>
								</div>
							</Show>
						</div>
					</>
				)}
			</Show>
		</div>
	);
}
