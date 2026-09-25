// ── /chat/mem 单条消息：user 气泡 / assistant（可勾选卡片清单或 Markdown） ──

import { Markdown as MarkdownRenderer } from "@components/ui";
import { copyTextWithToast } from "@shared/utils";
import { type Component, createSignal, For, Show } from "solid-js";
import type { ChatNode } from "../api.ts";
import styles from "../ChatMemPage.module.css";
import type { useChatMem } from "../hooks/useChatMem.ts";
import { BranchBar } from "./BranchBar.tsx";
import { MessageShell } from "./MessageShell.tsx";
import { PREVIEW_LEN } from "./preview.ts";
import { ThinkingBlock } from "./ThinkingBlock.tsx";

function copyNode(node: ChatNode) {
	void copyTextWithToast(node.content);
}

type MemChat = ReturnType<typeof useChatMem>;
type ParsedCard = NonNullable<ReturnType<MemChat["parseCards"]>>[number];

const CardRow: Component<{
	c: MemChat;
	node: ChatNode;
	card: ParsedCard;
	index: () => number;
}> = (props) => (
	<label class={styles.cardRow}>
		<input
			type="checkbox"
			checked={props.c.isCardSelected(props.node.id, props.index())}
			onChange={() => props.c.toggleCard(props.node.id, props.index())}
		/>
		<span class={styles.cardCue}>{props.card.cue}</span>
		<span class={styles.cardTarget}>{props.card.target}</span>
	</label>
);

export function MessageRow(props: {
	c: ReturnType<typeof useChatMem>;
	node: ChatNode;
}) {
	const { c, node } = props;
	const isUser = node.role === "user";
	const cards = c.parseCards(node.content);
	const [showRaw, setShowRaw] = createSignal(false);
	/** 临时节点（负数 id）= 乐观插入中：AI 正在流式生成 */
	const streaming = () =>
		node.id < 0 && node.role === "assistant" && c.sending();

	return (
		<MessageShell
			styles={styles}
			node={node}
			headExtra={streaming() ? " · 生成中…" : ""}
			actions={
				<>
					<Show when={!streaming()}>
						<button
							type="button"
							class={styles.msgBtn}
							title="复制内容"
							onClick={() => void copyNode(node)}
						>
							复制
						</button>
					</Show>
					<Show when={!isUser && !streaming()}>
						<button
							type="button"
							class={styles.msgBtn}
							title="重新生成（作为新分支，原回复保留）"
							disabled={c.sending()}
							onClick={() => void c.regenerate(node.id)}
						>
							重新生成
						</button>
					</Show>
				</>
			}
		>
			{/* assistant + 可解析卡片 → 勾选清单 */}
			<Show
				when={!isUser && !streaming() ? cards : null}
				fallback={
					<div class={isUser ? styles.userBubble : styles.assistantBubble}>
						{isUser ? (
							<div class={styles.userWrap}>
								<div class={styles.userBubble}>{node.content}</div>
								<Show when={c.childrenOf(node.id).length > 1}>
									<BranchBar
										variant="mem"
										children={c.childrenOf(node.id)}
										isActive={(id) => c.isInSubtree(id)}
										onSelect={(id) => c.focusBranch(id)}
										title="切换到该回复"
										chipText={(child) =>
											child.content.slice(0, PREVIEW_LEN) || "AI 回复"
										}
									/>
								</Show>
							</div>
						) : streaming() ? (
							// 流式期间：实时 Markdown 渲染（内容走 signal，零重建）
							<div class={styles.messageMd}>
								<Show
									when={c.streamingContent()}
									fallback={<span class={styles.thinking}>思考中…</span>}
								>
									<MarkdownRenderer content={c.streamingContent()} />
								</Show>
								<span class={styles.streamCursor} />
							</div>
						) : (
							<div class={styles.messageMd}>
								<ThinkingBlock
									reasoning={() => node.reasoning}
									done={() => !!node.content}
									open={streaming()}
								/>
								<MarkdownRenderer content={node.content} />
							</div>
						)}
					</div>
				}
			>
				{(parsed) => (
					<div class={styles.cardsPanel}>
						<div class={styles.cardsPanelHead}>
							<span class={styles.cardsPanelTitle}>
								AI 生成的卡片（{parsed().length} 张）
							</span>
							<button
								type="button"
								class={styles.msgBtn}
								onClick={() => setShowRaw(!showRaw())}
							>
								{showRaw() ? "收起原文" : "查看原文"}
							</button>
						</div>
						<Show when={showRaw()}>
							<pre class={styles.rawBox}>{node.content}</pre>
						</Show>
						<For each={parsed()}>
							{(card, i) => <CardRow c={c} node={node} card={card} index={i} />}
						</For>
					</div>
				)}
			</Show>
		</MessageShell>
	);
}
