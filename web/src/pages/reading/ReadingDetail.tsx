import { A, useParams } from "@solidjs/router";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import {
	getArticle,
	getArticleNotes,
	markWord,
	recommendNext,
	updateArticleNotes,
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

	// 笔记
	const [notes, setNotes] = createSignal("");
	const [notesLoaded, setNotesLoaded] = createSignal(false);

	createEffect(() => {
		if (detail() && !notesLoaded()) {
			document.title = `${detail()!.article.title} · Brainbow`;
			getArticleNotes(id()).then((r) => {
				setNotes(r.notes);
				setNotesLoaded(true);
			});
		}
	});

	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	const handleNotesBlur = () => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => updateArticleNotes(id(), notes()), 300);
	};

	// 乐观更新
	const [localStatus, setLocalStatus] = createSignal<
		Map<string, "known" | "unknown" | "ignored">
	>(new Map());

	// 合并后端 + 乐观更新为单一 Map → O(1) 查找
	const wordStatusMap = createMemo(() => {
		const map = new Map<string, "known" | "unknown" | "ignored">();
		for (const w of detail()?.words ?? []) {
			map.set(w.word, w.status as "known" | "unknown" | "ignored");
		}
		for (const [word, status] of localStatus()) {
			map.set(word, status);
		}
		return map;
	});

	// 侧栏排序：不认识 → 忽略 → 认识
	const sortedWords = createMemo(() => {
		const order: Record<string, number> = { unknown: 0, ignored: 1, known: 2 };
		const map = wordStatusMap();
		return [...(detail()?.words ?? [])].sort(
			(a, b) =>
				(order[map.get(a.word) ?? "known"] ?? 2) -
				(order[map.get(b.word) ?? "known"] ?? 2),
		);
	});

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
			handleMark(word, "unknown");
			return;
		}
		clickTimer = setTimeout(() => {
			clickTimer = undefined;
			handleMark(word, "known");
		}, 250);
	};

	// 事件委托：一个 handler 代替每个 span 的 onClick/onContextMenu
	const handleContentClick = (e: MouseEvent) => {
		const word = (e.target as HTMLElement).dataset.word;
		if (word) handleWordClick(word);
	};

	const handleContentContextMenu = (e: MouseEvent) => {
		const word = (e.target as HTMLElement).dataset.word;
		if (word) {
			e.preventDefault();
			handleMark(word, "ignored");
		}
	};

	// 批量提交不认识词
	const [uploadingUnknown, setUploadingUnknown] = createSignal(false);
	const handleUploadUnknown = async () => {
		const unknownWords: string[] = [];
		const map = wordStatusMap();
		for (const w of detail()?.words ?? []) {
			if (map.get(w.word) === "unknown") unknownWords.push(w.word);
		}
		if (unknownWords.length === 0) return;

		setUploadingUnknown(true);
		try {
			await Promise.all(unknownWords.map((w) => markWord(w, "unknown")));
			refetch();
		} finally {
			setUploadingUnknown(false);
		}
	};

	// 复制不认识词 + 笔记
	const handleCopyUnknown = async () => {
		const unknownWords: string[] = [];
		const map = wordStatusMap();
		for (const w of detail()?.words ?? []) {
			if (map.get(w.word) === "unknown") unknownWords.push(w.word);
		}
		const noteText = notes().trim();
		const parts = [unknownWords.join("\n")];
		if (noteText) parts.push(noteText);
		const text = parts.join("\n\n");
		if (!text) return;
		await navigator.clipboard.writeText(text);
	};

	// 内容渲染（data-word 属性 + 事件委托，无内联事件）
	const renderContent = (text: string) => {
		const map = wordStatusMap();
		const paragraphs = text.split(/\n/);

		return paragraphs.map((para) => {
			if (para.trim().length === 0) return <br />;

			const sentences = splitSentences(para);
			const rendered = sentences.map((sentence) => {
				const tokens = sentence.split(/(\s+)/);
				const renderedTokens = tokens.flatMap((token) => {
					const parts = token.split(/([^a-zA-Z'-]+)/);
					return parts.map((part) => {
						const isWord = part.length > 0 && /[a-zA-Z']/.test(part);
						if (!isWord) return part;

						const clean = part.toLowerCase();
						const s = map.get(clean);
						const cls =
							s === "known" || s === "ignored"
								? styles.word
								: styles.unknownWord;

						return (
							<span class={cls} data-word={clean}>
								{part}
							</span>
						);
					});
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
									{d().words.filter((w) => w.status === "unknown").length}{" "}
									个不认识
								</span>
							</div>
						</div>

						<Show when={recommended()?.recommended}>
							{(rec) => (
								<A href={`/reading/${rec().id}`} class={styles.recommendBanner}>
									推荐下一篇：{rec().title}（认识率{" "}
									{(rec().known_ratio * 100).toFixed(0)}%）
								</A>
							)}
						</Show>

						<div
							class={styles.content}
							role="application"
							onClick={handleContentClick}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleContentClick(e as never);
							}}
							onContextMenu={handleContentContextMenu}
						>
							{renderContent(d().article.content)}
						</div>

						<div class={styles.sidebar}>
							<div class={styles.wordListArea}>
								<h3>文章词表</h3>
								<button
									type="button"
									class={styles.uploadUnknownBtn}
									onClick={handleUploadUnknown}
									disabled={uploadingUnknown()}
								>
									{uploadingUnknown() ? "上传中…" : "上传全部不认识词"}
								</button>
								<div class={styles.wordList}>
									<For each={sortedWords()}>
										{(w) => {
											const st = wordStatusMap().get(w.word) ?? "unknown";
											return (
												<div
													class={styles.wordItem}
													classList={{
														[styles.knownWord]: st === "known",
														[styles.ignoredWordSidebar]: st === "ignored",
													}}
												>
													<button type="button"
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
													</button>
													<span class={styles.wordName}>{w.word}</span>
													<button
													type="button"
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
							<div class={styles.sidebarFooter}>
								<div class={styles.notesSection}>
									<h3>词组笔记</h3>
									<textarea
										class={styles.notesInput}
										value={notes()}
										onInput={(e) => setNotes(e.currentTarget.value)}
										onBlur={handleNotesBlur}
										placeholder={"输入词组或笔记，每行一个\n保存后下次打开仍在"}
										rows={4}
									/>
								</div>
								<button
									type="button"
									class={styles.copyBtn}
									onClick={handleCopyUnknown}
								>
									📋 复制不认识词 + 笔记
								</button>
							</div>
						</div>
					</>
				)}
			</Show>
		</div>
	);
}
