import { createResource, Show, For } from "solid-js";
import { A, useParams } from "@solidjs/router";
import { request } from "../apis/request.ts";
import MarkdownRenderer from "../components/ui/Markdown.tsx";
import styles from "./ConvDetail.module.css";

interface QaPair {
	qa_id: number;
	question: string;
	answer: string;
}

interface ConvQaData {
	conv_id: number;
	title: string;
	conv_type: string;
	created_at: string;
	qa_pairs: QaPair[];
}

const typeLabel: Record<string, string> = {
	concept: "概念",
	solution: "方案",
	explanation: "解释",
	summary: "总结",
};

export default function ConvQaPage() {
	const params = useParams();
	const [data] = createResource(() => params.id, (id) =>
		request<ConvQaData>(`/conv/qa/${id}`),
	);

	return (
		<div class={styles.page}>
			<Show when={data()} fallback={<div class={styles.loading}>加载中…</div>}>
				{(d) => (
					<>
						<div class={styles.topBar}>
							<A href="/conv" class={styles.backLink}>← 搜索</A>
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
