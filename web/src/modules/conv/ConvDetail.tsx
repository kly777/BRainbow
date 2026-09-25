import {
	AsyncSection,
	LoadingSkeleton,
	Markdown as MarkdownRenderer,
} from "@components/ui";
import { fmtLocal } from "@shared/utils";
import { For, Show } from "solid-js";
import styles from "./ConvDetail.module.css";
import ConvTopBar from "./components/ConvTopBar.tsx";
import { typeLabel } from "./hooks/type-labels.ts";
import { useConvDetail } from "./hooks/useConvDetail.ts";

export default function ConvDetailPage() {
	const m = useConvDetail();

	// 四态（错误 → 骨架 → 空 → 内容）交给共享外壳：判断顺序写进原语，
	// 页面不再自己拼 <Show> 嵌套（那正是"错误被骨架挡住"这类事故的来源）
	return (
		<div class={styles.page}>
			<AsyncSection
				data={m.data}
				loading={m.dataLoading}
				error={m.dataError}
				onRetry={m.refetch}
				skeleton={<LoadingSkeleton />}
			>
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
							<Show when={d().articles.length === 0}>
								<div class={styles.empty}>该条目下暂无文章</div>
							</Show>
						</div>
					</>
				)}
			</AsyncSection>
		</div>
	);
}
