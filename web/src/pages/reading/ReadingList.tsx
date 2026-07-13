import { A, useSearchParams } from "@solidjs/router";
import {
	createEffect,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import {
	listArticles,
	uploadArticle,
	type ArticleSummary,
} from "../../apis/readingApi.ts";
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
		try {
			await uploadArticle(title().trim(), content().trim());
			setTitle("");
			setContent("");
			setUploadOpen(false);
			refetch();
		} finally {
			setUploading(false);
		}
	};

	return (
		<div class={styles.page}>
			<div class={styles.header}>
				<h1>英语阅读</h1>
				<A href="/reading/unknown" class={styles.unknownLink}>
					不认识词表
				</A>
				<button class={styles.uploadBtn} onClick={() => setUploadOpen(true)}>
					+ 上传文章
				</button>
			</div>

			{/* 上传 Modal */}
			<Show when={uploadOpen()}>
				<div class={styles.overlay} onClick={() => setUploadOpen(false)} />
				<div class={styles.modal}>
					<h2>上传文章</h2>
					<input
						class={styles.input}
						placeholder="文章标题"
						value={title()}
						onInput={(e) => setTitle(e.currentTarget.value)}
					/>
					<textarea
						class={styles.textarea}
						placeholder="粘贴全文…"
						value={content()}
						onInput={(e) => setContent(e.currentTarget.value)}
						rows={12}
					/>
					<div class={styles.modalActions}>
						<button
							class={styles.cancelBtn}
							onClick={() => setUploadOpen(false)}
						>
							取消
						</button>
						<button
							class={styles.submitBtn}
							onClick={handleUpload}
							disabled={uploading() || !title().trim() || !content().trim()}
						>
							{uploading() ? "上传中…" : "导入"}
						</button>
					</div>
				</div>
			</Show>

			{/* 文章列表 */}
			<div class={styles.list}>
				<For
					each={articles()?.articles}
					fallback={<div class={styles.empty}>还没有文章，上传第一篇吧</div>}
				>
					{(a: ArticleSummary) => (
						<A href={`/reading/${a.id}`} class={styles.card}>
							<div class={styles.cardTitle}>{a.title}</div>
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
		</div>
	);
}
