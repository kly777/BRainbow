import { A, useParams } from "@solidjs/router";
import { createResource, createSignal, For, Show } from "solid-js";
import {
	getArticle,
	markWord,
	recommendNext,
} from "../../apis/readingApi.ts";
import styles from "./ReadingDetail.module.css";

function splitSentences(text: string): string[] {
	return text.split(/(?<=[.!?])\s+/);
}

export default function ReadingDetail() {
	const params = useParams();
	const id = () => Number(params.id);

	const [detail, { refetch }] = createResource(id, getArticle);
	const [recommended] = createResource(id, recommendNext);

	// 乐观更新：本地覆盖后端返回的状态
	const [localStatus, setLocalStatus] = createSignal<
		Map<string, "known" | "unknown" | "ignored">
	>(new Map());

	const wordStatus = (word: string): "known" | "unknown" | "ignored" => {
		const local = localStatus().get(word);
		if (local) return local;
		const w = detail()?.words.find((w) => w.word === word);
		return w?.status ?? "unknown";
	};

	const wordKnown = (word: string) => wordStatus(word) === "known" || wordStatus(word) === "ignored";

	const handleMark = async (
		word: string,
		status: "known" | "unknown" | "ignored",
	) => {
		const prev = localStatus();
		setLocalStatus((prev) => new Map(prev).set(word, status));
		try {
			await markWord(word, status);
		} catch {
			setLocalStatus(prev);
			return;
		}
		refetch();
	};

	// 单击/双击 debounce
	let clickTimer: ReturnType<typeof setTimeout> | undefined;
	const handleWordClick = (word: string) => {
		if (clickTimer) {
			clearTimeout(clickTimer);
			clickTimer = undefined;
			// 双击 → 不认识
			handleMark(word, "unknown");
			return;
		}
		clickTimer = setTimeout(() => {
			clickTimer = undefined;
			// 单击 → 认识
			handleMark(word, "known");
		}, 250);
	};

	// 批量提交不认识词
	const [uploadingUnknown, setUploadingUnknown] = createSignal(false);
	const handleUploadUnknown = async () => {
		const allWords = detail()?.words ?? [];
		const unknownWords = allWords
			.filter((w) => wordStatus(w.word) === "unknown")
			.map((w) => w.word);
		if (unknownWords.length === 0) return;

		setUploadingUnknown(true);
		try {
			await Promise.all(unknownWords.map((w) => markWord(w, "unknown")));
			refetch();
		} finally {
			setUploadingUnknown(false);
		}
	};

	const renderContent = (text: string) => {
		const paragraphs = text.split(/\n/);

		return paragraphs.map((para) => {
			if (para.trim().length === 0) {
				return <br />;
			}

			const sentences = splitSentences(para);
			const rendered = sentences.map((sentence) => {
				const tokens = sentence.split(/(\s+)/);
				const renderedTokens = tokens.map((token) => {
					const clean = token.replace(/[^a-zA-Z']/g, "").toLowerCase();
					const isWord = clean.length > 0 && /[a-zA-Z]/.test(token);
					if (!isWord) return token;

					const cls = wordKnown(clean) ? styles.word : styles.unknownWord;

					return (
						<span
							class={cls}
							onContextMenu={(e) => {
								e.preventDefault();
								handleMark(clean, "ignored");
							}}
							onClick={() => handleWordClick(clean)}
						>
							{token}
						</span>
					);
				});
				return <span>{renderedTokens} </span>;
			});

			return <div class={styles.paragraph}>{rendered}</div>;
		});
	};

	return (
		<div class={styles.page}>
			<A href="/reading" class={styles.back}>
				← 文章列表
			</A>

			<Show when={detail()}>
				{(d) => (
					<>
						<div class={styles.header}>
							<h1>{d().article.title}</h1>
							<div class={styles.meta}>
								<span>{d().article.word_count} 词</span>
								<span>
									{d().words.filter((w) => w.status === "unknown").length} 个不认识
								</span>
							</div>
						</div>

						<Show when={recommended()?.recommended}>
							{(rec) => (
								<A
									href={`/reading/${rec().id}`}
									class={styles.recommendBanner}
								>
									推荐下一篇：{rec().title}（认识率{" "}
									{(rec().known_ratio * 100).toFixed(0)}%）
								</A>
							)}
						</Show>

						<div class={styles.content}>{renderContent(d().article.content)}</div>

						<div class={styles.sidebar}>
							<h3>文章词表</h3>
							<button
								class={styles.uploadUnknownBtn}
								onClick={handleUploadUnknown}
								disabled={uploadingUnknown()}
							>
								{uploadingUnknown() ? "上传中…" : "上传全部不认识词"}
							</button>
							<div class={styles.wordList}>
								<For each={d().words}>
									{(w) => {
										const st = wordStatus(w.word);
										return (
											<div
												class={styles.wordItem}
												classList={{
													[styles.knownWord]: st === "known",
													[styles.ignoredWordSidebar]: st === "ignored",
												}}
											>
												<span
													class={
														st === "known"
															? styles.knownIcon
															: st === "ignored"
																? styles.ignoredIcon
																: styles.unknownIcon
													}
													onClick={() =>
														handleMark(
															w.word,
															st === "known"
																? "unknown"
																: st === "ignored"
																	? "unknown"
																	: "known",
														)
													}
												>
													{st === "known"
														? "✓"
														: st === "ignored"
															? "–"
															: "✗"}
												</span>
												<span class={styles.wordName}>{w.word}</span>
												<button
													class={styles.ignoreBtn}
													onClick={() => handleMark(w.word, "ignored")}
													title={st === "ignored" ? "取消忽略" : "忽略此词"}
												>
													{st === "ignored" ? "取消" : "忽略"}
												</button>
											</div>
										);
									}}
								</For>
							</div>
						</div>
					</>
				)}
			</Show>
		</div>
	);
}
