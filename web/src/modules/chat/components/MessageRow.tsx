// ── 单条消息（/chat）：气泡 + 思考块 + Markdown 内容 + 分支条 ──

import { Markdown as MarkdownRenderer } from "@components/ui";
import type { ChatNode } from "@modules/chat";
import { Show } from "solid-js";
import type { useChatPage } from "../hooks/useChatPage.ts";
import { BranchBar } from "./BranchBar.tsx";
import { copyNode } from "./ChatPageParts.tsx";
import styles from "./MessageRow.module.css";
import { MessageShell } from "./MessageShell.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";

export function MessageRow(props: {
	c: ReturnType<typeof useChatPage>;
	node: ChatNode;
}) {
	const { c, node } = props;
	const isFocused = () => c.focusId() === node.id;
	const children = () => c.childrenOf(node.id);
	const isUser = node.role === "user";
	/** 临时节点（负数 id）= 乐观插入中：AI 正在流式生成 */
	const streaming = () =>
		node.id < 0 && node.role === "assistant" && c.sending();

	return (
		<MessageShell
			styles={styles}
			node={node}
			rowClass={isFocused() ? styles.focused : undefined}
			headExtra={
				streaming() ? " · 生成中…" : node.revised_from !== null ? " · 修订" : ""
			}
			timeFirst
			actions={
				<Show when={!streaming()}>
					<button
						type="button"
						class={styles.msgBtn}
						title="复制内容"
						onClick={() => void copyNode(node)}
					>
						复制
					</button>
					<Show when={!isUser}>
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
					<button
						type="button"
						class={styles.msgBtn}
						title="修订此消息（原版保留）"
						onClick={() => {
							c.setEditText(node.content);
							c.setEditingNode(node);
						}}
					>
						修订
					</button>
				</Show>
			}
			footer={
				<Show when={!streaming() && children().length > 1}>
					<BranchBar
						children={children()}
						isActive={(id) => c.isInSubtree(id)}
						onSelect={(id) => c.focusBranch(id)}
						title="切换到该分支"
					/>
				</Show>
			}
		>
			<div class={isUser ? styles.userBubble : styles.assistantBubble}>
				{isUser ? (
					node.content
				) : (
					<div class={styles.messageMd}>
						<ThinkingBlock
							reasoning={() =>
								streaming() ? c.streamingReasoning() : node.reasoning
							}
							done={() =>
								streaming() ? !!c.streamingContent() : !!node.content
							}
							open={streaming()}
						/>
						<Show
							when={streaming() || !!node.content}
							fallback={<span class={styles.thinking}>思考中…</span>}
						>
							<MarkdownRenderer
								content={streaming() ? c.streamingContent() : node.content}
							/>
						</Show>
						<Show when={streaming()}>
							<span class={styles.streamCursor} />
						</Show>
					</div>
				)}
			</div>
		</MessageShell>
	);
}
