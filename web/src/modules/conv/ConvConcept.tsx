import {
	ErrorRetry,
	LoadingSkeleton,
	Markdown as MarkdownRenderer,
} from "@components/ui";
import { getConvConceptE } from "@modules/conv";
import { strParam, useUrlParams } from "@shared/utils";
import { useParams } from "@solidjs/router";
import { createResource, Show } from "solid-js";
import styles from "./ConvDetail.module.css";
import ConvTopBar from "./components/ConvTopBar.tsx";
import { useBackHref } from "./hooks/useBackHref.ts";

export default function ConvConceptPage() {
	const params = useParams();
	const urlParams = useUrlParams({ article: strParam("") });

	const [data, { refetch }] = createResource(
		() => ({ id: params.id, article: urlParams.get("article") }),
		({ id, article }) => getConvConceptE(Number(id), String(article || "")),
	);
	const backHref = useBackHref();

	return (
		<div class={styles.page}>
			{/* 错误时短路：data() 在 error 存在时会 throw（Solid 1.9 语义） */}
			<Show
				when={data.error}
				fallback={
					<Show when={data()} fallback={<LoadingSkeleton />}>
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
				}
			>
				<ErrorRetry error={data.error} onRetry={refetch} />
			</Show>
		</div>
	);
}
