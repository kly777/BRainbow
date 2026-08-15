import { Button, Markdown as MarkdownRenderer } from "@components/ui";
import { getErrorMessage } from "@lib/api";
import { getConvDetailE } from "@modules/conv";
import { useParams } from "@solidjs/router";
import { createResource, For, Show } from "solid-js";
import styles from "./ConvDetail.module.css";
import ConvTopBar from "./components/ConvTopBar.tsx";
import { typeLabel } from "./hooks/type-labels.ts";
import { useBackHref } from "./hooks/useBackHref.ts";

export default function ConvDetailPage() {
	const params = useParams();
	const id = () => params.id;

	const [data, { refetch }] = createResource(id, (id) =>
		getConvDetailE(Number(id)),
	);
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
									<Show when={d().articles.length === 0}>
										<div class={styles.empty}>该条目下暂无文章</div>
									</Show>
								</div>
							</>
						)}
					</Show>
				}
			>
				<div class={styles.errorMsg}>
					加载失败：{getErrorMessage(data.error)}
					<Button variant="primary" size="sm" onClick={refetch}>
						重试
					</Button>
				</div>
			</Show>
		</div>
	);
}
