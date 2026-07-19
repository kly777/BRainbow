import { useParams, useSearchParams } from "@solidjs/router";
import { createResource, Show } from "solid-js";
import MarkdownRenderer from "../../components/ui/Markdown.tsx";
import { getConvConceptE } from "./api.ts";
import styles from "./ConvDetail.module.css";
import { useBackHref } from "./logic/useBackHref.ts";
import ConvTopBar from "./ui/ConvTopBar.tsx";

export default function ConvConceptPage() {
	const params = useParams();
	const [searchParams] = useSearchParams();

	const [data] = createResource(
		() => ({ id: params.id, article: searchParams.article }),
		({ id, article }) => getConvConceptE(Number(id), String(article || "")),
	);
	const backHref = useBackHref();

	return (
		<div class={styles.page}>
			<Show when={data()} fallback={<div class={styles.loading}>加载中…</div>}>
				{(d) => (
					<>
						<ConvTopBar
							title={d().title}
							type={d().article_type}
							backHref={backHref()}
						/>
						<div class={styles.body}>
							<div class={styles.md}>
								<MarkdownRenderer content={d().content} />
							</div>
						</div>
					</>
				)}
			</Show>
		</div>
	);
}
