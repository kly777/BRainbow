import { AsyncView, Button, Modal } from "@components/ui";
import { fillPath, PATHS } from "@config/paths";
import { fmtLocal, notifyError, tryAsync } from "@lib/utils";
import type { ArticleSummary } from "@modules/reading";
import { listArticles, uploadArticle } from "@modules/reading";
import { A } from "@solidjs/router";
import { createResource, createSignal, For } from "solid-js";
import styles from "./ReadingList.module.css";

export default function ReadingList() {
	const [articles, { refetch }] = createResource(listArticles);
	const [uploadOpen, setUploadOpen] = createSignal(false);
	const [title, setTitle] = createSignal("");
	const [content, setContent] = createSignal("");
	const [uploading, setUploading] = createSignal(false);

	const handleUpload = async () => {
		if (!title().trim() || !content().trim()) return;
		setUploading(true);
		const result = await tryAsync(() =>
			uploadArticle(title().trim(), content().trim()),
		);
		if (result.ok) {
			setTitle("");
			setContent("");
			setUploadOpen(false);
			refetch();
		} else {
			notifyError("上传文章失败", result.error);
		}
		setUploading(false);
	};

	return (
		<div class={styles.page}>
			<div class={styles.header}>
				<h1>英语阅读</h1>
				<div class={styles.headerActions}>
					<A href={PATHS.readingUnknown} class={styles.headerLink}>
						不认识词表
					</A>
					<Button
						variant="primary"
						size="sm"
						onClick={() => setUploadOpen(true)}
					>
						+ 上传文章
					</Button>
				</div>
			</div>

			<Modal
				isOpen={uploadOpen()}
				onClose={() => setUploadOpen(false)}
				title="上传文章"
				actions={
					<>
						<Button
							variant="secondary"
							onClick={() => setUploadOpen(false)}
							disabled={uploading()}
						>
							取消
						</Button>
						<Button
							variant="primary"
							onClick={handleUpload}
							disabled={uploading() || !title().trim() || !content().trim()}
						>
							{uploading() ? "上传中…" : "导入"}
						</Button>
					</>
				}
			>
				<div class={styles.field}>
					<label for="reading-title" class={styles.fieldLabel}>
						文章标题
					</label>
					<input
						id="reading-title"
						class={styles.input}
						placeholder="请输入文章标题"
						value={title()}
						onInput={(e) => setTitle(e.currentTarget.value)}
					/>
				</div>
				<div class={styles.field}>
					<label for="reading-content" class={styles.fieldLabel}>
						全文
					</label>
					<textarea
						id="reading-content"
						class={styles.textarea}
						placeholder="粘贴全文…"
						value={content()}
						onInput={(e) => setContent(e.currentTarget.value)}
						rows={12}
					/>
				</div>
			</Modal>

			<p class={styles.sortHint}>
				按推荐阅读顺序排列：认识率越接近 90% 越靠前，最该读的排在第一张。
			</p>

			<AsyncView
				data={articles()?.articles}
				loading={articles.loading}
				error={articles.error}
				onRetry={refetch}
				emptyMessage="还没有文章，上传第一篇吧"
			>
				{(items) => (
					<div class={styles.list}>
						<For each={items}>
							{(a: ArticleSummary, i) => (
								<A
									href={fillPath(PATHS.readingDetail, a.id)}
									class={styles.card}
									classList={{
										[styles.recommendedCard]: i() === 0,
									}}
									data-known={
										a.known_ratio >= 0.8
											? "high"
											: a.known_ratio >= 0.5
												? "mid"
												: "low"
									}
								>
									<div class={styles.cardTitleRow}>
										<div class={styles.cardTitle}>{a.title}</div>
										{i() === 0 && (
											<span class={styles.recommendedTag}>推荐先读</span>
										)}
									</div>
									<div class={styles.cardMeta}>
										<span>{a.word_count} 词</span>
										<span
											class={styles.ratio}
											data-known={
												a.known_ratio >= 0.8
													? "high"
													: a.known_ratio >= 0.5
														? "mid"
														: "low"
											}
										>
											{(a.known_ratio * 100).toFixed(0)}% 认识
										</span>
										<span class={styles.unknownCount}>
											{a.unknown_word_count} 个不认识
										</span>
										<span class={styles.createdAt}>
											{fmtLocal(a.created_at)}
										</span>
									</div>
									<div class={styles.barOuter}>
										<div
											class={styles.barInner}
											style={{ width: `${(a.known_ratio * 100).toFixed(0)}%` }}
										/>
									</div>
								</A>
							)}
						</For>
					</div>
				)}
			</AsyncView>
		</div>
	);
}
