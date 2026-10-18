import { Button, Input, ListPage, Modal, Textarea } from "@components/ui";
import { PATHS } from "@config/paths";
import { notifyError, tryAsync, useListResource } from "@shared/utils";
import { A } from "@solidjs/router";
import { createSignal, For } from "solid-js";
import type { ArticleSummary } from "./api.ts";
import { listArticles, uploadArticle } from "./api.ts";
import ArticleCard from "./components/ArticleCard.tsx";
import styles from "./ReadingList.module.css";

export default function ReadingList() {
	// 端点是包装数组（{articles}），交原语归一成单页列表：四态、错误信号、乐观更新
	// 都由它负责，页面不再自己拼 createResource + 内联四态分支
	const list = useListResource<null, ArticleSummary>({
		key: () => null,
		fetcher: async () => (await listArticles()).articles,
	});
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
			// 新文章的 known_ratio / unknown_word_count 是后端算的，前端编不出来，
			// 所以这里重取而不是乐观插入 —— 用 silent 避免列表闪骨架
			await list.reload({ silent: true });
		} else {
			notifyError("上传文章失败", result.error);
		}
		setUploading(false);
	};

	return (
		<>
			<ListPage
				class={styles.page}
				title="英语阅读"
				actions={
					<>
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
					</>
				}
				filters={
					<p class={styles.sortHint}>
						按推荐阅读顺序排列：认识率越接近 90% 越靠前，最该读的排在第一张。
					</p>
				}
				data={list.items()}
				loading={list.loading()}
				error={list.error()}
				onRetry={list.refetch}
				emptyMessage="还没有文章，上传第一篇吧"
			>
				{(items) => (
					<div class={styles.list}>
						<For each={items()}>
							{(a: ArticleSummary, i) => (
								<ArticleCard article={a} first={i() === 0} />
							)}
						</For>
					</div>
				)}
			</ListPage>

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
					<Input
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
					<Textarea
						id="reading-content"
						placeholder="粘贴全文…"
						value={content()}
						onInput={(e) => setContent(e.currentTarget.value)}
						rows={12}
					/>
				</div>
			</Modal>
		</>
	);
}
