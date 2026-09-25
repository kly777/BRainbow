import {
	AsyncSection,
	LoadingSkeleton,
	Markdown as MarkdownRenderer,
} from "@components/ui";
import { getConvConceptE } from "@modules/conv";
import { strParam, useDetailResource, useUrlParams } from "@shared/utils";
import { useParams } from "@solidjs/router";
import styles from "./ConvDetail.module.css";
import ConvTopBar from "./components/ConvTopBar.tsx";
import { useBackHref } from "./hooks/useBackHref.ts";

export default function ConvConceptPage() {
	const params = useParams();
	const urlParams = useUrlParams({ article: strParam("") });

	// 键是 (id, article) 组合：原语的 id 是泛型，直接用对象即可
	const detail = useDetailResource<
		Awaited<ReturnType<typeof getConvConceptE>>,
		{ id: string | undefined; article: string }
	>({
		id: () => ({ id: params.id, article: urlParams.get("article") }),
		fetcher: ({ id, article }) => getConvConceptE(Number(id), article),
	});
	const backHref = useBackHref();

	return (
		<div class={styles.page}>
			<AsyncSection
				data={detail.data}
				loading={detail.loading}
				error={detail.error}
				onRetry={detail.refetch}
				skeleton={<LoadingSkeleton />}
			>
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
			</AsyncSection>
		</div>
	);
}
