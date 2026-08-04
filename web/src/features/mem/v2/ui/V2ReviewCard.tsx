// ── v2 复习卡片：目录卡 + 3D 翻面 + 卡牌层叠 ──
// 线索与答案分居卡片两面，点"显示答案"实体翻转。

import { Show } from "solid-js";
import MarkdownRenderer from "../../../../components/ui/Markdown.tsx";
import MarkdownEditor from "../../../../components/ui/MarkdownEditor.tsx";
import { fmtInterval, fmtLocal } from "../../../../lib/time.ts";
import { useSpeech } from "../../logic/useSpeech.ts";
import type { UseMemReview } from "../../logic/useMemReview.ts";
import * as styles from "./V2ReviewCard.css.ts";

interface V2ReviewCardProps {
	m: UseMemReview;
}

export default function V2ReviewCard(props: V2ReviewCardProps) {
	const { m } = props;
	const speech = useSpeech();

	const goPrev = () => {
		m.setCurrent(Math.max(0, m.current() - 1));
		m.setShowAnswer(false);
	};
	const goNext = () => {
		m.setCurrent(Math.min(m.due().length - 1, m.current() + 1));
		m.setShowAnswer(false);
	};

	return (
		<>
			{/* 完成态 */}
			<Show when={m.done()}>
				<div class={styles.empty}>
					<p class={styles.emptyTitle}>🎉 本轮学习完成！</p>
					<Show when={m.upcoming() > 0}>
						<p class={styles.emptyHint}>还有 {m.upcoming()} 张卡在未来等待复习</p>
					</Show>
					<button type="button" class={styles.primaryBtn} onClick={m.loadDue}>
						再学一轮
					</button>
				</div>
			</Show>

			{/* 卡片区 */}
			<Show
				when={!m.loading() && !m.done() && m.due().length > 0}
				fallback={
					<div class={styles.empty}>
						{m.loading() ? "加载中…" : "没有记忆卡片，去添加一些吧！"}
					</div>
				}
			>
				<Show when={m.allFar()}>
					<div class={styles.banner}>
						📅 所有卡的下次复习都在 24h 之后，当前为提前复习
					</div>
				</Show>

				{/* 编辑模式：普通纵向布局 */}
				<Show when={m.editing()}>
					<div class={styles.cardWrap}>
						<div class={styles.cardFlat}>
							<div class={styles.section}>
								<div class={styles.sectionLabel}>线索</div>
								<MarkdownEditor
									class={styles.editArea}
									value={m.editCue()}
									onInput={m.setEditCue}
									rows={3}
								/>
							</div>
							<div class={styles.divider} />
							<div class={styles.section}>
								<div class={styles.sectionLabel}>答案</div>
								<MarkdownEditor
									class={styles.editArea}
									value={m.editTarget()}
									onInput={m.setEditTarget}
									rows={3}
								/>
							</div>
						</div>
					</div>
				</Show>

				{/* 复习模式：翻面卡片 */}
				<Show when={!m.editing()}>
					<div class={styles.cardWrap}>
						<Show when={m.isPreview() && m.current() === 0}>
							<div class={styles.previewBanner}>
								将于 {fmtLocal(m.item()?.due_at ?? "")} 到期
							</div>
						</Show>

					{/* 复习卡片 */}
					<div class={styles.cardStage}>
						{/* 目录卡：线索常显 + 答案展开 */}
						<div class={styles.card}>
							{/* 线索段 */}
							<div class={styles.face}>
								<div class={styles.cardTab}>
									<span class={styles.cardTabText}>线索</span>
									<span class={styles.cardTabNo}>#{m.item()?.id}</span>
								</div>
								<div class={styles.cardBody}>
									<div class={styles.content}>
										<MarkdownRenderer
											content={m.item()?.cue.content ?? ""}
										/>
									</div>
								</div>
								<div class={styles.cardTools}>
									<button
										type="button"
										class={styles.toolBtn}
										title="朗读线索"
										onClick={() =>
											speech.toggle(m.item()?.cue.content ?? "")
										}
										disabled={!speech.supported}
									>
										{speech.speaking() ? "⏹" : "🔊"}
									</button>
									<button
										type="button"
										class={styles.toolBtn}
										title="复制线索"
										onClick={() =>
											navigator.clipboard.writeText(
												m.item()?.cue.content ?? "",
											)
										}
									>
										📋
									</button>
									<button
										type="button"
										class={styles.toolBtn}
										title="复制整张卡片"
										onClick={m.handleCopyCard}
									>
										📋+
									</button>
									<button
										type="button"
										class={styles.toolBtn}
										title={m.mnemonic() ? "重新生成助记" : "AI 生成助记"}
										onClick={m.generateMnemonic}
										disabled={m.mnemonicLoading()}
									>
										{m.mnemonicLoading() ? "⏳" : "🤖"}
									</button>
								</div>
							</div>

							{/* 答案段（显示答案后展开） */}
							<Show when={m.showAnswer()}>
								<div class={styles.answer}>
									<div class={styles.cardTab}>
										<span class={styles.cardTabText}>答案</span>
										<span class={styles.cardTabNo}>
											#{m.item()?.id} · {m.item()?.state}
										</span>
									</div>
									<div class={styles.cardBody}>
										<div class={styles.content}>
											<MarkdownRenderer
												content={m.item()?.target.content ?? ""}
											/>
										</div>

										<Show when={m.mnemonic() || m.mnemonicLoading()}>
											<div class={styles.mnemonic}>
												<div class={styles.mnemonicLabel}>💡 AI 助记</div>
												<Show
													when={m.mnemonicLoading()}
													fallback={
														<MarkdownRenderer
															content={m.mnemonic() ?? ""}
														/>
													}
												>
													<span class={styles.mnemonicLoading}>生成中…</span>
												</Show>
											</div>
										</Show>
									</div>
								</div>
							</Show>
						</div>
					</div>
					</div>
					{/* 操作行：未翻面时（固定在底部中间） */}
					<Show when={!m.showAnswer()}>
						<div class={styles.actionRow}>
							<button
								type="button"
								class={styles.navBtn}
								onClick={goPrev}
								disabled={m.current() <= 0}
								title="上一张 (←)"
							>
								‹
							</button>
							<button type="button" class={styles.ghostBtn} onClick={m.bury}>
								跳过
							</button>
							<button
								type="button"
								class={styles.ghostBtn}
								onClick={m.resumeSuspend}
							>
								挂起
							</button>
							<Show when={m.showUndo()}>
								<button type="button" class={styles.ghostBtn} onClick={m.undo}>
									撤销
								</button>
							</Show>
							<button
								type="button"
								class={styles.primaryBtn}
								onClick={() => m.setShowAnswer(true)}
							>
								显示答案
							</button>
							<button
								type="button"
								class={styles.navBtn}
								onClick={goNext}
								disabled={m.current() >= m.due().length - 1}
								title="下一张 (→)"
							>
								›
							</button>
						</div>
					</Show>

					{/* 评分：翻面后 */}
					<Show when={m.showAnswer()}>
						<div class={styles.ratings}>
							<button
								type="button"
								class={styles.ratingBtn}
								classList={{ [styles.again]: true }}
								onClick={() => m.rate(1)}
							>
								<span class={styles.ratingLabel}>忘记</span>
								<span class={styles.ratingTime}>
									{fmtInterval(m.intervals()[0])}
								</span>
							</button>
							<button
								type="button"
								class={styles.ratingBtn}
								classList={{ [styles.hard]: true }}
								onClick={() => m.rate(2)}
							>
								<span class={styles.ratingLabel}>困难</span>
								<span class={styles.ratingTime}>
									{fmtInterval(m.intervals()[1])}
								</span>
							</button>
							<button
								type="button"
								class={styles.ratingBtn}
								classList={{ [styles.good]: true }}
								onClick={() => m.rate(3)}
							>
								<span class={styles.ratingLabel}>良好</span>
								<span class={styles.ratingTime}>
									{fmtInterval(m.intervals()[2])}
								</span>
							</button>
							<button
								type="button"
								class={styles.ratingBtn}
								classList={{ [styles.easy]: true }}
								onClick={() => m.rate(4)}
							>
								<span class={styles.ratingLabel}>简单</span>
								<span class={styles.ratingTime}>
									{fmtInterval(m.intervals()[3])}
								</span>
							</button>
						</div>
					</Show>
				</Show>
			</Show>
		</>
	);
}
