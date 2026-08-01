// ── 复习卡片 + 操作区 ──

import { Show } from "solid-js";
import MarkdownRenderer from "../../../components/ui/Markdown.tsx";
import MarkdownEditor from "../../../components/ui/MarkdownEditor.tsx";
import { fmtInterval, fmtLocal } from "../../../lib/time.ts";
import { useSpeech } from "../logic/useSpeech.ts";
import type { UseMemReview } from "../logic/useMemReview.ts";
import styles from "../MemPage.module.css";

interface MemReviewCardProps {
	m: UseMemReview;
}

export default function MemReviewCard(props: MemReviewCardProps) {
	const { m } = props;
	const speech = useSpeech();

	return (
		<>
			{/* 完成态 */}
			<Show when={m.done()}>
				<div class={styles.empty}>
					<p>🎉 本轮学习完成！</p>
					{m.upcoming() > 0 && (
						<p class={styles.hint}>还有 {m.upcoming()} 张卡在未来等待复习</p>
					)}
					<button type="button" class={styles.showBtn} onClick={m.loadDue}>
						再学一轮
					</button>
				</div>
			</Show>

			{/* 卡片区域 */}
			<Show
				when={!m.loading() && !m.done() && m.due().length > 0}
				fallback={
					<div class={styles.empty}>
						{m.loading() ? "加载中…" : "没有记忆卡片，去添加一些吧！"}
					</div>
				}
			>
				<Show when={m.allFar()}>
					<div class={styles.allFarBanner}>
						📅 所有卡的下次复习都在 24h 之后，当前为提前复习
					</div>
				</Show>

				<div class={styles.card}>
					<Show when={m.isPreview() && m.current() === 0}>
						<div class={styles.previewBanner}>
							将于 {fmtLocal(m.item()?.due_at ?? "")} 到期
						</div>
					</Show>

					{/* 复习模式 */}
					<Show when={!m.editing()}>
						<div class={styles.cue}>
							<div class={styles.sectionLabel}>
								线索
								<button
									type="button"
									class={styles.copyBtn}
									title="朗读线索"
									onClick={() => speech.toggle(m.item()?.cue.content ?? "")}
									disabled={!speech.supported}
								>
									{speech.speaking() ? "⏹" : "🔊"}
								</button>
								<button
									type="button"
									class={styles.copyBtn}
									title="复制线索"
									onClick={() =>
										navigator.clipboard.writeText(m.item()?.cue.content ?? "")
									}
								>
									📋
								</button>
								<button
									type="button"
									class={styles.copyBtn}
									title="复制整张卡片"
									onClick={m.handleCopyCard}
								>
									📋+
								</button>
								<button
									type="button"
									class={styles.copyBtn}
									title={m.mnemonic() ? "重新生成助记" : "AI 生成助记"}
									onClick={m.generateMnemonic}
									disabled={m.mnemonicLoading()}
								>
									{m.mnemonicLoading() ? "⏳" : "🤖"}
								</button>
							</div>
							<div class={styles.content}>
								<MarkdownRenderer content={m.item()?.cue.content ?? ""} />
							</div>
						</div>
						<Show when={m.showAnswer()}>
							<div class={styles.divider} />
							<div class={styles.target}>
								<div class={styles.sectionLabel}>答案</div>
								<div class={styles.content}>
									<MarkdownRenderer content={m.item()?.target.content ?? ""} />
								</div>

								{/* AI 助记 */}
								<Show when={m.mnemonic() || m.mnemonicLoading()}>
									<div
										style={{
											"margin-top": "16px",
											padding: "12px 16px",
											background: "#f0fdf4",
											border: "1px solid #bbf7d0",
											"border-radius": "8px",
											"font-size": "14px",
										}}
									>
										<div
											style={{
												"font-weight": "600",
												"margin-bottom": "4px",
												"font-size": "12px",
												color: "#15803d",
											}}
										>
											💡 AI 助记
										</div>
										<Show
											when={m.mnemonicLoading()}
											fallback={
												<MarkdownRenderer content={m.mnemonic() ?? ""} />
											}
										>
											<span style={{ color: "#6b7280" }}>生成中…</span>
										</Show>
									</div>
								</Show>
							</div>
						</Show>
					</Show>

					{/* 编辑模式 */}
					<Show when={m.editing()}>
						<div class={styles.cue}>
							<div class={styles.sectionLabel}>线索</div>
							<MarkdownEditor
								class={styles.editArea}
								value={m.editCue()}
								onInput={m.setEditCue}
								rows={3}
							/>
						</div>
						<div class={styles.divider} />
						<div class={styles.target}>
							<div class={styles.sectionLabel}>答案</div>
							<MarkdownEditor
								class={styles.editArea}
								value={m.editTarget()}
								onInput={m.setEditTarget}
								rows={3}
							/>
						</div>
					</Show>
				</div>

				{/* 操作区 */}
				<div class={styles.actions}>
					<Show
						when={!m.showAnswer()}
						fallback={
							<div class={styles.ratings}>
								<button
									type="button"
									class={styles.again}
									onClick={() => m.rate(1)}
								>
									<span class={styles.ratingLabel}>忘记</span>
									<span class={styles.ratingTime}>
										{fmtInterval(m.intervals()[0])}
									</span>
								</button>
								<button
									type="button"
									class={styles.hard}
									onClick={() => m.rate(2)}
								>
									<span class={styles.ratingLabel}>困难</span>
									<span class={styles.ratingTime}>
										{fmtInterval(m.intervals()[1])}
									</span>
								</button>
								<button
									type="button"
									class={styles.good}
									onClick={() => m.rate(3)}
								>
									<span class={styles.ratingLabel}>良好</span>
									<span class={styles.ratingTime}>
										{fmtInterval(m.intervals()[2])}
									</span>
								</button>
								<button
									type="button"
									class={styles.easy}
									onClick={() => m.rate(4)}
								>
									<span class={styles.ratingLabel}>简单</span>
									<span class={styles.ratingTime}>
										{fmtInterval(m.intervals()[3])}
									</span>
								</button>
							</div>
						}
					>
						<div class={styles.actionRow}>
							<button type="button" class={styles.buryBtn} onClick={m.bury}>
								跳过
							</button>
							<button
								type="button"
								class={styles.buryBtn}
								onClick={m.resumeSuspend}
							>
								挂起
							</button>
							<Show when={m.showUndo()}>
								<button type="button" class={styles.undoBtn} onClick={m.undo}>
									撤销
								</button>
							</Show>
							<button
								type="button"
								class={styles.showBtn}
								onClick={() => m.setShowAnswer(true)}
							>
								显示答案
							</button>
						</div>
					</Show>
				</div>
			</Show>
		</>
	);
}
