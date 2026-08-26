import { Button, Tooltip } from "@components/ui";
import { fillPath, PATHS } from "@config/paths";
// ── 阅读详情页面（薄壳视图层）──

import { getErrorMessage } from "@shared/api";
import { A } from "@solidjs/router";
import { For, Show } from "solid-js";
import ArticleContent from "./components/ArticleContent";
import { useReadingDetail } from "./hooks/useReadingDetail.ts";
import styles from "./ReadingDetail.module.css";

export default function ReadingDetail() {
	const m = useReadingDetail();

	return (
		<div class={styles.page}>
			<A href={PATHS.reading} class={styles.back}>
				← 文章列表
			</A>
			{/* 错误时短路：detail() 在 error 存在时会 throw（Solid 1.9 语义） */}
			<Show
				when={m.detail.error}
				fallback={
					<Show
						when={m.detail()}
						fallback={
							<div
								class={styles.skeletonWrap}
								role="status"
								aria-label="文章加载中"
							>
								<div class={`skeleton ${styles.skBack}`} />
								<div class={styles.mainColumn}>
									<div class={`skeleton ${styles.skTitle}`} />
									<div class={`skeleton ${styles.skArticle}`} />
								</div>
								<div class={styles.sidebar}>
									<div class={`skeleton ${styles.skSideHead}`} />
									<div class={`skeleton ${styles.skRow}`} />
									<div class={`skeleton ${styles.skRow}`} />
									<div class={`skeleton ${styles.skRow}`} />
									<div class={`skeleton ${styles.skRow}`} />
								</div>
							</div>
						}
					>
						{(d) => (
							<>
								<div class={styles.mainColumn}>
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
									<Show when={m.recommended()?.recommended}>
										{(rec) => (
											<A
												href={fillPath(PATHS.readingDetail, rec().id)}
												class={styles.recommendBanner}
											>
												推荐下一篇：{rec().title}（认识率{" "}
												{(rec().known_ratio * 100).toFixed(0)}%）
											</A>
										)}
									</Show>
									<div
										class={styles.content}
										role="application"
										onClick={m.handleContentClick}
										onKeyDown={(e) => {
											if (e.key === "Enter") m.handleContentClick(e as never);
										}}
										onContextMenu={m.handleContentContextMenu}
									>
										<ArticleContent
											content={d().article.content}
											wordStatusMap={m.wordStatusMap}
										/>
									</div>
								</div>
								<div class={styles.sidebar}>
									<div class={styles.wordListArea}>
										<h3>文章词表</h3>
										<Button
											variant="secondary"
											size="sm"
											class={styles.sidebarAction}
											onClick={m.handleUploadUnknown}
											disabled={m.uploadingUnknown()}
										>
											{m.uploadingUnknown() ? "标记中…" : "标记全部为不认识"}
										</Button>
										<div class={styles.wordList}>
											<For each={m.sortedWords()}>
												{(w) => {
													const st = m.wordStatusMap().get(w.word) ?? "unknown";
													return (
														<div
															class={styles.wordItem}
															classList={{
																[styles.knownWord]: st === "known",
																[styles.ignoredWordSidebar]: st === "ignored",
															}}
														>
															<Tooltip
																label={`将 ${w.word} 标记为${
																	st === "known" ? "不认识" : "认识"
																}`}
															>
																<button
																	type="button"
																	class={styles.wordIcon}
																	classList={{
																		[styles.knownIcon]: st === "known",
																		[styles.ignoredIcon]: st === "ignored",
																		[styles.unknownIcon]: st === "unknown",
																	}}
																	onClick={() =>
																		m.handleMark(
																			w.word,
																			st === "known"
																				? "unknown"
																				: st === "ignored"
																					? "unknown"
																					: "known",
																		)
																	}
																	aria-label={`将 ${w.word} 标记为${
																		st === "known" ? "不认识" : "认识"
																	}`}
																	aria-pressed={st === "known"}
																>
																	{st === "known"
																		? "✓"
																		: st === "ignored"
																			? "–"
																			: "✗"}
																</button>
															</Tooltip>
															<span class={styles.wordName}>{w.word}</span>
															<button
																type="button"
																class={styles.ignoreBtn}
																onClick={() => m.handleMark(w.word, "ignored")}
																title={
																	st === "ignored" ? "取消忽略" : "忽略此词"
																}
																aria-label={
																	st === "ignored"
																		? `取消忽略 ${w.word}`
																		: `忽略 ${w.word}`
																}
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
												value={m.notes()}
												onInput={(e) => m.setNotes(e.currentTarget.value)}
												onBlur={m.handleNotesBlur}
												placeholder={
													"输入词组或笔记，每行一个\n保存后下次打开仍在"
												}
												rows={4}
												aria-label="词组笔记"
											/>
										</div>
										<Button
											variant="secondary"
											size="sm"
											class={styles.sidebarAction}
											onClick={m.handleCopyUnknown}
										>
											复制不认识词 + 笔记
										</Button>
									</div>
								</div>
							</>
						)}
					</Show>
				}
			>
				<div class={styles.errorMsg} role="alert">
					<p>加载失败：{getErrorMessage(m.detail.error)}</p>
					<Button variant="secondary" size="sm" onClick={m.refetch}>
						重试
					</Button>
				</div>
			</Show>
		</div>
	);
}
