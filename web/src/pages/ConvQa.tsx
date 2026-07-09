import { createResource, Show, For } from "solid-js";
import { A, useParams, useSearchParams } from "@solidjs/router";
import { getConvQaE, type ConvQaData } from "../apis/convApi.ts";
import MarkdownRenderer from "../components/ui/Markdown.tsx";
import styles from "./ConvDetail.module.css";

const typeLabel: Record<string, string> = {
	concept: "概念",
	solution: "方案",
	explanation: "解释",
	summary: "总结",
};

export default function ConvQaPage() {
	const params = useParams();
	const [searchParams] = useSearchParams();
	const [data] = createResource(() => params.id, (id) =>
		getConvQaE(Number(id)),
	);

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
							<A href={backHref()} class={styles.backLink}>← 搜索</A>
							<div class={styles.titleArea}>
								<h1 class={styles.title}>{d().title}</h1>
								<span class={styles.tag}>{typeLabel[d().conv_type] || d().conv_type}</span>
								<span class={styles.date}>{d().created_at.slice(0, 10)}</span>
							</div>
						</div>
						<div class={styles.body}>
							<div class={styles.qaSection}>
								<h2 class={styles.sectionTitle}>对话记录</h2>
								<For each={d().qa_pairs}>
									{(qa) => (
										<div class={styles.qaBlock}>
											<div class={styles.question}>
												<span class={styles.qLabel}>Q</span>
												<div class={styles.md}><MarkdownRenderer content={qa.question} /></div>
											</div>
											<div class={styles.answer}>
												<span class={styles.aLabel}>A</span>
												<div class={styles.md}><MarkdownRenderer content={qa.answer} /></div>
											</div>
										</div>
									)}
								</For>
							</div>
						</div>
					</>
				)}
			</Show>
		</div>
	);
}
