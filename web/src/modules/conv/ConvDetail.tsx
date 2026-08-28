import {
	Button,
	LoadingSkeleton,
	Markdown as MarkdownRenderer,
} from "@components/ui";
import { getErrorMessage } from "@shared/api";
import { fmtLocal } from "@shared/utils";
import { For, Show } from "solid-js";
import styles from "./ConvDetail.module.css";
import ConvTopBar from "./components/ConvTopBar.tsx";
import { typeLabel } from "./hooks/type-labels.ts";
import { useConvDetail } from "./hooks/useConvDetail.ts";

export default function ConvDetailPage() {
	const m = useConvDetail();

	return (
		<div class={styles.page}>
			<Show
				when={m.dataError}
				fallback={
					<Show when={m.data()} fallback={<LoadingSkeleton />}>
						{(d) => (
							<>
								<ConvTopBar
									title={d().title}
									type={d().conv_type}
									date={fmtLocal(d().created_at)}
									backHref={m.backHref()}
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
					加载失败：{getErrorMessage(m.dataError)}
					<Button variant="primary" size="sm" onClick={m.refetch}>
						重试
					</Button>
				</div>
			</Show>
		</div>
	);
}
