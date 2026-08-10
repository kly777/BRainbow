// ── AI 生成记忆卡片视图 ──
// 输入文本 → 生成卡片 → 勾选微调 → 导入（复用 useMemAdd 导入管线）

import { createSignal, For, Show } from "solid-js";
import MarkdownEditor from "@ui/molecules/MarkdownEditor";
import {
	ImportActions,
	ImportResult,
	ImportTagInput,
} from "@features/mem/ui/ImportParts.tsx";
import type { useMemAdd } from "@features/mem/logic/useMemAdd.ts";
import type { UseMemAi } from "@features/mem/logic/useMemAi.ts";
import styles from "@features/mem/ui/AiGenerateView.module.css";

export function AiGenerateView(props: {
	ai: UseMemAi;
	m: ReturnType<typeof useMemAdd>;
}) {
	const { ai, m } = props;
	const [reviseInput, setReviseInput] = createSignal("");

	const handleImport = async () => {
		const rows = ai.cards().map((c) => ({
			cue: c.cue,
			target: c.target,
			tags: [],
			selected: true,
		}));
		if (rows.length === 0) return;
		m.setPreviewRows(rows);
		await m.handlePasteImport();
	};

	return (
		<Show
			when={m.importResult()}
			fallback={
				<div class={styles.stack}>
					{/* ── 输入文本 ── */}
					<div class={styles.inputCard}>
						<label for="ai-source-text" class={styles.label}>
							输入文本（文章 / 笔记 / 讲义片段）
						</label>
						<MarkdownEditor
							id="ai-source-text"
							class={styles.textarea}
							rows={6}
							placeholder={
								"例如：\n\n光的折射遵循斯涅耳定律：n₁·sinθ₁ = n₂·sinθ₂……"
							}
							value={ai.text()}
							onInput={ai.setText}
						/>
						<div class={styles.actions}>
							<button
								type="button"
								class={styles.cancel}
								onClick={() => m.navigate("/m")}
							>
								取消
							</button>
							<button
								type="button"
								class={styles.submit}
								disabled={ai.loading() || !ai.text().trim()}
								onClick={() => void ai.generate()}
							>
								{ai.loading()
									? "生成中…"
									: ai.cards().length > 0
										? "重新生成"
										: "AI 生成卡片"}
							</button>
						</div>
						<Show when={ai.error()}>
							<p class={styles.importErrors}>{ai.error()}</p>
						</Show>
					</div>

					{/* ── 卡片清单（可编辑 + 渐进修改） ── */}
					<Show when={ai.cards().length > 0}>
						<div class={styles.previewCard}>
							<div class={styles.previewTab}>
								<span class={styles.previewTabText}>
									AI 生成的卡片（{ai.cards().length} 张，可编辑）
								</span>
								<button
									type="button"
									class={styles.ghostBtn}
									onClick={ai.clear}
								>
									清空
								</button>
							</div>
							<div class={styles.cardList}>
								<For each={ai.cards()}>
									{(card, i) => (
										<div class={styles.cardRow}>
											<div class={styles.cardNo}>#{i() + 1}</div>
											<div class={styles.cardFields}>
												<input
													type="text"
													class={styles.cueInput}
													placeholder="线索"
													value={card.cue}
													onInput={(e) =>
														ai.updateCard(i(), { cue: e.currentTarget.value })
													}
												/>
												<input
													type="text"
													class={styles.targetInput}
													placeholder="答案"
													value={card.target}
													onInput={(e) =>
														ai.updateCard(i(), {
															target: e.currentTarget.value,
														})
													}
												/>
											</div>
										</div>
									)}
								</For>
							</div>

							{/* ── 渐进修改：AI 修订 ── */}
							<div class={styles.reviseBox}>
								<input
									type="text"
									class={styles.reviseInput}
									placeholder="让 AI 修改：例如「简化答案」「补充一个例子」「把第二条改得更口语」"
									value={reviseInput()}
									onInput={(e) => setReviseInput(e.currentTarget.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") void ai.reviseAll(reviseInput());
									}}
								/>
								<button
									type="button"
									class={styles.reviseBtn}
									disabled={ai.loading() || !reviseInput().trim()}
									onClick={() => void ai.reviseAll(reviseInput())}
								>
									{ai.loading() ? "修改中…" : "AI 修改"}
								</button>
							</div>
						</div>

						<ImportTagInput
							value={m.importDefaultTags()}
							onChange={m.setImportDefaultTags}
						/>
						<ImportActions
							onCancel={() => m.navigate("/m")}
							onSubmit={() => void handleImport()}
							loading={m.importing() || ai.loading()}
							submitLabel={`导入 ${ai.cards().length} 张卡片`}
						/>
					</Show>
				</div>
			}
		>
			<ImportResult result={m.importResult()!} onContinue={m.resetImport} />
		</Show>
	);
}
