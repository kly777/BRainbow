import { getConvDetailE } from "@features/conv/api.ts";
import styles from "@features/conv/ConvDetail.module.css";
import { typeLabel } from "@features/conv/logic/constants.ts";
import { useBackHref } from "@features/conv/logic/useBackHref.ts";
import ConvTopBar from "@features/conv/ui/ConvTopBar.tsx";
import QaPairList from "@features/conv/ui/QaPairList.tsx";
import { getErrorMessage } from "@shared/api/types/errors.ts";
import MarkdownRenderer from "@shared/ui/atoms/Markdown";
import { useParams, useSearchParams } from "@solidjs/router";
import { createResource, For, Show } from "solid-js";

export default function ConvDetailPage() {
	const params = useParams();
	const [searchParams] = useSearchParams();
	const id = () => params.id;
	const articleOnly = () => searchParams.mode === "article";

	const [data] = createResource(id, (id) => getConvDetailE(Number(id)));
	const backHref = useBackHref();

	return (
		<div class={styles.page}>
			{/* 错误时短路：data() 在 error 存在时会 throw（Solid 1.9 语义） */}
			<Show
				when={data.error}
				fallback={
					<Show
						when={data()}
						fallback={<div class={styles.loading}>加载中…</div>}
					>
						{(d) => (
							<>
								<ConvTopBar
									title={d().title}
									type={d().conv_type}
									date={d().created_at.slice(0, 10)}
									backHref={backHref()}
								/>
								<div class={styles.body}>
									<Show when={!articleOnly()}>
										<QaPairList pairs={d().qa_pairs} />
									</Show>
									<Show when={d().articles.length > 0}>
										<div class={styles.articleSection}>
											<h2 class={styles.sectionTitle}>总结 / 概念</h2>
											<For each={d().articles}>
												{(art) => (
													<div class={styles.articleBlock}>
														<h3 class={styles.articleTitle}>
															<span class={styles.artTag}>
																{typeLabel[art.article_type] ||
																	art.article_type}
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
				}
			>
				<div class={styles.errorMsg}>{getErrorMessage(data.error)}</div>
			</Show>
		</div>
	);
}
