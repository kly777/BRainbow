import { PATHS } from "@config/paths";

// ── /chat/mem：对话式记忆卡片生成 ──
// 与 /chat 是同一主页面的两个分支：共用 ChatSidebar / useChatSession，
// 差异仅在会话 kind（mem）与右侧内容（卡片清单 / 导入）。

import { ArrowLeft } from "@components/ui/icons";
import { createSignal, For, onMount, Show } from "solid-js";
import styles from "./ChatMemPage.module.css";
import { MessageRow as ChatMemMessageRow } from "./components/ChatMemMessageRow.tsx";
import { ChatSidebar, ToggleSidebar } from "./components/ChatSidebar.tsx";
import { Composer } from "./components/Composer.tsx";
import { useAutoScroll } from "./hooks/useAutoScroll.ts";
import { useChatMem } from "./hooks/useChatMem.ts";

export default function ChatMemPage() {
	const c = useChatMem();
	const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
	let listRef: HTMLDivElement | undefined;
	const autoScroll = useAutoScroll(() => listRef);
	autoScroll.follow(() => c.activePath());

	onMount(() => void c.loadTrees());

	return (
		<div class={styles.page}>
			{/* ── 会话列表（与 /chat 共用 ChatSidebar） ── */}
			<ChatSidebar
				trees={c.trees}
				loadingTrees={c.loadingTrees}
				currentTreeId={() => c.current()?.tree.id}
				collapsed={sidebarCollapsed()}
				title="记忆卡片会话"
				backHref={PATHS.memory}
				backLabel={
					<>
						<ArrowLeft size={14} /> 记忆
					</>
				}
				newLabel="＋ 新会话"
				emptyText="还没有会话，点击“＋ 新会话”开始"
				hint="粘贴文本 → AI 生成卡片 → 对话修订 → 勾选导入"
				onCreate={() => void c.createSession()}
				onSelect={(id) => c.selectSession(id)}
				onRename={(id, title) => void c.renameSession(id, title)}
				onAiTitle={(id) => c.aiTitleSession(id)}
				onDelete={(id) => c.removeSession(id)}
			/>

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
								<ToggleSidebar
									collapsed={sidebarCollapsed()}
									onClick={() => setSidebarCollapsed(!sidebarCollapsed())}
								/>
								<h2 class={styles.headerTitle}>{cur().tree.title}</h2>
								<ImportBar c={c} />
							</div>
							<div class={styles.messageList} ref={listRef}>
								<MemMessageRows c={c} />
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

// ── 消息行列表：提取 For，使 ChatMemPage 的 JSX 嵌套深度不超过 5 ──

function MemMessageRows(props: { c: ReturnType<typeof useChatMem> }) {
	return (
		<For each={props.c.activePath()}>
			{(node) => <ChatMemMessageRow c={props.c} node={node} />}
		</For>
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
