import { createResource, Show } from "solid-js";
import { A, useParams, useSearchParams } from "@solidjs/router";
import { request } from "../apis/request.ts";
import MarkdownRenderer from "../components/ui/Markdown.tsx";
import styles from "./ConvDetail.module.css";

interface ConvConceptData {
	conv_id: number;
	article_type: string;
	title: string;
	content: string;
}

const typeLabel: Record<string, string> = {
	concept: "概念",
	solution: "方案",
	explanation: "解释",
	summary: "总结",
};

export default function ConvConceptPage() {
	const params = useParams();
	const [searchParams] = useSearchParams();

	const [data] = createResource(
		() => ({ id: params.id, article: searchParams.article }),
		({ id, article }) =>
			request<ConvConceptData>(`/conv/concept/${id}?article=${encodeURIComponent(String(article || ""))}`),
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
								<span class={styles.tag}>{typeLabel[d().article_type] || d().article_type}</span>
							</div>
						</div>
						<div class={styles.body}>
							<div class={styles.md}><MarkdownRenderer content={d().content} /></div>
						</div>
					</>
				)}
			</Show>
		</div>
	);
}
