import { PATHS } from "@config/paths";
// ── /chat/mem：对话式记忆卡片生成 ──
// 左侧：卡片生成会话列表（新建 / 删除 / 切换）
// 右侧：对话流（user 气泡 / AI 回复），assistant 的 JSON 卡片渲染为可勾选清单，
//       底部"导入所选"把勾选卡片写入记忆库。

import { Markdown as MarkdownRenderer } from "@components/ui";
import type { ChatNode } from "@modules/chat";
import { A } from "@solidjs/router";
import { createSignal, For, onMount, Show } from "solid-js";
import styles from "./ChatMemPage.module.css";
import { BranchBar } from "./components/BranchBar.tsx";
import { Composer } from "./components/Composer.tsx";
import { MessageShell } from "./components/MessageShell.tsx";
import { ThinkingBlock } from "./components/ThinkingBlock.tsx";
import { useAutoScroll } from "./hooks/useAutoScroll.ts";
import { useChatMem } from "./hooks/useChatMem.ts";

export default function ChatMemPage() {
	const c = useChatMem();
	let listRef: HTMLDivElement | undefined;
	const autoScroll = useAutoScroll(() => listRef);
	autoScroll.follow(() => c.activePath());

	onMount(() => void c.loadTrees());

	return (
		<div class={styles.page}>
			{/* ── 会话列表 ── */}
			<aside class={styles.sidebar}>
				<div class={styles.sidebarHead}>
					<A href={PATHS.memory} class={styles.backLink}>
						← 记忆
					</A>
					<button
						type="button"
						class={styles.newBtn}
						onClick={() => void c.createSession()}
					>
						＋ 新会话
					</button>
				</div>
				<div class={styles.sidebarHint}>
					粘贴文本 → AI 生成卡片 → 对话修订 → 勾选导入
				</div>
				<div class={styles.treeList}>
					<For each={c.trees()}>
						{(tree) => (
							<div
								class={
									c.current()?.tree.id === tree.id
										? styles.sessionActive
										: styles.session
								}
							>
								<button
									type="button"
									class={styles.sessionSelect}
									onClick={() => c.selectSession(tree.id)}
								>
									<span class={styles.sessionTitle}>{tree.title}</span>
									<span class={styles.sessionMeta}>{tree.node_count} 条</span>
								</button>
								<button
									type="button"
									class={styles.sessionDelete}
									title="删除会话"
									onClick={(e) => {
										e.stopPropagation();
										void c.removeSession(tree.id);
									}}
								>
									✕
								</button>
							</div>
						)}
					</For>
					<Show when={c.trees().length === 0 && !c.loadingTrees()}>
						<div class={styles.treeEmpty}>还没有会话，点击"＋ 新会话"开始</div>
					</Show>
				</div>
			</aside>

			{/* ── 对话区 ── */}
			<main class={styles.main}>
				<Show
					when={c.current()}
					fallback={
						<div class={styles.emptyState}>
							<p class={styles.emptyTitle}>对话式记忆卡片生成</p>
							<p class={styles.emptyHint}>
								左侧新建会话，粘贴任意文本（文章 / 笔记 / 讲义）， AI
								将生成记忆卡片；可继续对话让 AI 修订，最后勾选导入。
							</p>
						</div>
					}
				>
					{(cur) => (
						<>
							<Show when={c.error()}>
								<div class={styles.errorBanner}>{c.error()}</div>
							</Show>
							<div class={styles.header}>
								<h2 class={styles.headerTitle}>{cur().tree.title}</h2>
								<ImportBar c={c} />
							</div>
							<div class={styles.messageList} ref={listRef}>
								<For each={c.activePath()}>
									{(node) => <MessageRow c={c} node={node} />}
								</For>
								<Composer
									styles={styles}
									sending={c.sending}
									input={c.input}
									onInput={c.setInput}
									onSend={() => void c.send()}
									placeholder={() =>
										c.activePath().length === 0
											? "粘贴文本，AI 将生成记忆卡片…（Enter 发送）"
											: "输入修改指令，如「把答案简化」…"
									}
									sendLabel={() => (c.sending() ? "生成中…" : "发送")}
								/>
							</div>
						</>
					)}
				</Show>
			</main>
		</div>
	);
}

// ── 导入栏：勾选统计 + 全选 + 导入 ──

function ImportBar(props: { c: ReturnType<typeof useChatMem> }) {
	const { c } = props;
	const rows = c.allCardRows;
	const total = () => rows().length;
	const cov = () => c.coverage();

	return (
		<Show when={total() > 0}>
			<div class={styles.importBar}>
				<label class={styles.selectAll}>
					<input
						type="checkbox"
						checked={c.selected().size === total() && total() > 0}
						onChange={() => c.toggleAll()}
					/>
					全选
				</label>
				<span class={styles.importCount}>
					已选 {c.selected().size} / {total()}
				</span>
				{/* 覆盖不足提示 */}
				<Show when={cov().expected > 0 && cov().missing > 0}>
					<span
						class={styles.coverageWarn}
						title="AI 可能遗漏了部分知识点，可在对应回复上点「重新生成」"
					>
						已生成 {cov().generated} / 期望 {cov().expected}
					</span>
				</Show>
				<button
					type="button"
					class={styles.importBtn}
					disabled={c.importing() || c.selected().size === 0}
					onClick={() => void c.importSelected()}
				>
					{c.importing() ? "导入中…" : `导入所选 (${c.selected().size})`}
				</button>
			</div>
		</Show>
	);
}

// ── 单条消息：user 气泡 / assistant（卡片或 Markdown） ──

function MessageRow(props: {
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
										styles={styles}
										children={c.childrenOf(node.id)}
										isActive={(id) => c.isInSubtree(id)}
										onSelect={(id) => c.focusBranch(id)}
										title="切换到该回复"
										chipText={(child) =>
											child.content.slice(0, 24) || "AI 回复"
										}
									/>
								</Show>
							</div>
						) : streaming() ? (
							// 流式期间：先显示思考动画，token 到达后实时渲染原始 JSON（零解析开销）
							<div class={styles.messageMd}>
								<Show
									when={node.content}
									fallback={<span class={styles.thinking}>思考中…</span>}
								>
									<pre class={styles.rawBox}>{node.content}</pre>
								</Show>
								<span class={styles.streamCursor} />
							</div>
						) : (
							<div class={styles.messageMd}>
								<ThinkingBlock
									styles={styles}
									reasoning={() => node.reasoning}
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
							{(card, i) => (
								<label class={styles.cardRow}>
									<input
										type="checkbox"
										checked={c.isCardSelected(node.id, i())}
										onChange={() => c.toggleCard(node.id, i())}
									/>
									<span class={styles.cardCue}>{card.cue}</span>
									<span class={styles.cardTarget}>{card.target}</span>
								</label>
							)}
						</For>
					</div>
				)}
			</Show>
		</MessageShell>
	);
}
