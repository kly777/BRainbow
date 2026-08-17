import { PATHS } from "@config/paths";
// ── /chat/mem：对话式记忆卡片生成 ──
// 左侧：卡片生成会话列表（新建 / 删除 / 切换）
// 右侧：对话流（user 气泡 / AI 回复），assistant 的 JSON 卡片渲染为可勾选清单，
//       底部"导入所选"把勾选卡片写入记忆库。

import { A } from "@solidjs/router";
import { For, onMount, Show } from "solid-js";
import styles from "./ChatMemPage.module.css";
import { MessageRow as ChatMemMessageRow } from "./components/ChatMemMessageRow.tsx";
import { Composer } from "./components/Composer.tsx";
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
									{(node) => <ChatMemMessageRow c={c} node={node} />}
								</For>
								<Composer
									styles={styles}
									sending={c.sending}
									input={c.input}
									onInput={c.setInput}
									onSend={() => void c.send()}
									onStop={() => c.stopStreaming()}
									placeholder={() =>
										c.activePath().length === 0
											? "粘贴文本，AI 将生成记忆卡片…（Enter 换行，Shift+Enter 发送）"
											: "输入修改指令，如「把答案简化」…（Enter 换行，Shift+Enter 发送）"
									}
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
