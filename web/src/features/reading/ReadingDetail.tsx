// ── 阅读详情页面（薄壳视图层）──

import { A } from "@solidjs/router";
import { For, Show } from "solid-js";
import { useReadingDetail } from "./logic/useReadingDetail.ts";
import styles from "./ReadingDetail.module.css";

function splitSentences(text: string): string[] { return text.split(/(?<=[.!?])\s+/); }

export default function ReadingDetail() {
	const m = useReadingDetail();

	// 内容渲染（纯视图，data-word + 事件委托）
	const renderContent = (text: string) =>
		text.split(/\n/).map((para) => {
			if (para.trim().length === 0) return <br />;
			const sentences = splitSentences(para);
			const rendered = sentences.map((sentence) => {
				const tokens = sentence.split(/(\s+)/);
				const renderedTokens = tokens.flatMap((token) =>
					token.split(/([^a-zA-Z'-]+)/).map((part) => {
						const isWord = part.length > 0 && /[a-zA-Z']/.test(part);
						if (!isWord) return part;
						const clean = part.toLowerCase();
						const s = m.wordStatusMap().get(clean);
						const cls = s === "known" || s === "ignored" ? styles.word : styles.unknownWord;
						return <span class={cls} data-word={clean}>{part}</span>;
					}));
				return <span>{renderedTokens} </span>;
			});
			return <div class={styles.paragraph}>{rendered}</div>;
		});

	return (
		<div class={styles.page}>
			<A href="/reading" class={styles.back}>← 文章列表</A>
			<Show when={m.detail()}>
				{(d) => (
					<>
						<div class={styles.header}>
							<h1>{d().article.title}</h1>
							<div class={styles.meta}>
								<span>{d().article.word_count} 词</span>
								<span>{d().words.filter((w) => w.status === "unknown").length} 个不认识</span>
							</div>
						</div>
						<Show when={m.recommended()?.recommended}>
							{(rec) => (
								<A href={`/reading/${rec().id}`} class={styles.recommendBanner}>
									推荐下一篇：{rec().title}（认识率 {(rec().known_ratio * 100).toFixed(0)}%）
								</A>
							)}
						</Show>
						<div class={styles.content} role="application"
							onClick={m.handleContentClick}
							onKeyDown={(e) => { if (e.key === "Enter") m.handleContentClick(e as never); }}
							onContextMenu={m.handleContentContextMenu}>
							{renderContent(d().article.content)}
						</div>
						<div class={styles.sidebar}>
							<div class={styles.wordListArea}>
								<h3>文章词表</h3>
								<button type="button" class={styles.uploadUnknownBtn}
									onClick={m.handleUploadUnknown} disabled={m.uploadingUnknown()}>
									{m.uploadingUnknown() ? "上传中…" : "上传全部不认识词"}
								</button>
								<div class={styles.wordList}>
									<For each={m.sortedWords()}>
										{(w) => {
											const st = m.wordStatusMap().get(w.word) ?? "unknown";
											return (
												<div class={styles.wordItem} classList={{ [styles.knownWord]: st === "known", [styles.ignoredWordSidebar]: st === "ignored" }}>
													<button type="button" class={st === "known" ? styles.knownIcon : st === "ignored" ? styles.ignoredIcon : styles.unknownIcon}
														onClick={() => m.handleMark(w.word, st === "known" ? "unknown" : st === "ignored" ? "unknown" : "known")}>
														{st === "known" ? "✓" : st === "ignored" ? "–" : "✗"}
													</button>
													<span class={styles.wordName}>{w.word}</span>
													<button type="button" class={styles.ignoreBtn} onClick={() => m.handleMark(w.word, "ignored")}
														title={st === "ignored" ? "取消忽略" : "忽略此词"}>
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
									<textarea class={styles.notesInput} value={m.notes()}
										onInput={(e) => m.setNotes(e.currentTarget.value)}
										onBlur={m.handleNotesBlur}
										placeholder={"输入词组或笔记，每行一个\n保存后下次打开仍在"} rows={4} />
								</div>
								<button type="button" class={styles.copyBtn} onClick={m.handleCopyUnknown}>📋 复制不认识词 + 笔记</button>
							</div>
						</div>
					</>
				)}
			</Show>
		</div>
	);
}
