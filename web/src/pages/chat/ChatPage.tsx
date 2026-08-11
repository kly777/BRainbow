// ── 对话页：AI 多轮对话（树状分支 / 修订 / 搜索 / 预设提示词） ──

import type { ChatNode, ChatTree } from "@entities/chat";
import styles from "@pages/chat/ChatPage.module.css";
import { useChatPage } from "@pages/chat/model/useChatPage.ts";
import { Markdown as MarkdownRenderer } from "@shared/ui";
import { createSignal, For, onMount, Show } from "solid-js";

export default function ChatPage() {
	const c = useChatPage();
	const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

	onMount(() => {
		void c.loadTrees();
		void c.loadPresets();
	});

	return (
		<div class={styles.page}>
			{/* ── 侧边栏：搜索 + 树列表 ── */}
			<aside
				class={sidebarCollapsed() ? styles.sidebarCollapsed : styles.sidebar}
			>
				<div class={styles.searchBox}>
					<input
						type="text"
						class={styles.searchInput}
						placeholder="搜索对话 / 消息…"
						value={c.searchQ()}
						onInput={(e) => c.onSearchInput(e.currentTarget.value)}
					/>
					<Show when={c.searchOpen()}>
						<div class={styles.searchResults}>
							<Show
								when={!c.searching() && c.searchHits().length === 0}
								fallback={
									<For each={c.searchHits()}>
										{(hit) => (
											<button
												type="button"
												class={styles.searchHit}
												onClick={() => c.gotoHit(hit)}
											>
												<span class={styles.searchHitTitle}>
													{hit.tree_title}
												</span>
												<span class={styles.searchHitSnippet}>
													{hit.snippet}
												</span>
											</button>
										)}
									</For>
								}
							>
								<div class={styles.searchEmpty}>
									{c.searching() ? "搜索中…" : "无结果"}
								</div>
							</Show>
						</div>
					</Show>
				</div>

				<div class={styles.sidebarHead}>
					<span class={styles.sidebarTitle}>对话</span>
					<button
						type="button"
						class={styles.newBtn}
						onClick={() => void c.quickCreate()}
					>
						＋ 新建
					</button>
				</div>

				<div class={styles.treeList}>
					<For each={c.trees()}>
						{(tree) => (
							<TreeListItem
								tree={tree}
								active={c.current()?.tree.id === tree.id}
								onSelect={() => c.selectTree(tree.id)}
								onDelete={() => c.removeTree(tree.id)}
							/>
						)}
					</For>
					<Show when={c.trees().length === 0 && !c.loadingTrees()}>
						<div class={styles.treeEmpty}>
							还没有对话，点击"＋ 新建"立即开始
						</div>
					</Show>
				</div>
			</aside>

			{/* ── 对话区 ── */}
			<main class={styles.main}>
				<Show
					when={c.current()}
					fallback={
						<div class={styles.emptyState}>
							<p class={styles.emptyTitle}>AI 对话工作台</p>
							<p class={styles.emptyHint}>
								左侧选择或新建一个对话。支持多轮对话、分支讨论、修改上下文。
							</p>
						</div>
					}
				>
					{(cur) => (
						<>
							<button
								type="button"
								class={styles.sidebarToggle}
								title={sidebarCollapsed() ? "展开侧边栏" : "收起侧边栏"}
								onClick={() => setSidebarCollapsed(!sidebarCollapsed())}
							>
								{sidebarCollapsed() ? "☰" : "◀"}
							</button>
							<TreeHeader c={c} tree={cur().tree} />
							<div class={styles.messageList}>
								<For each={c.activePath()}>
									{(node) => <MessageRow c={c} node={node} />}
								</For>
								<Show when={c.sending() && c.streamingContent()}>
									<div class={`${styles.messageRow} ${styles.streaming}`}>
										<span class={styles.avatar} aria-hidden="true">
											AI
										</span>
										<div class={styles.messageCol}>
											<div class={styles.messageHead}>
												<span class={styles.messageRole}>AI · 生成中…</span>
											</div>
											<div class={styles.assistantBubble}>
												<div class={styles.messageMd}>
													<MarkdownRenderer content={c.streamingContent()} />
													<span class={styles.streamCursor} />
												</div>
											</div>
										</div>
									</div>
								</Show>
							</div>
							<div class={styles.inputBar}>
								<div class={styles.inputShell}>
									<textarea
										class={styles.inputArea}
										placeholder={
											c.focusId() === null
												? "开始对话…（Enter 发送，Shift+Enter 换行）"
												: "继续对话…（将追加到当前消息之后）"
										}
										value={c.input()}
										onInput={(e) => c.setInput(e.currentTarget.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter" && !e.shiftKey) {
												e.preventDefault();
												void c.send();
											}
										}}
									/>
									<button
										type="button"
										class={styles.sendBtn}
										disabled={c.sending() || !c.input().trim()}
										onClick={() => void c.send()}
									>
										{c.sending() ? "发送中…" : "发送"}
									</button>
								</div>
							</div>
						</>
					)}
				</Show>
			</main>

			{/* ── 编辑弹层 ── */}
			<Show when={c.editingNode()}>
				{(ed) => (
					<div
						class={styles.editOverlay}
						role="none"
						onClick={() => c.setEditingNode(null)}
					>
						<div
							class={styles.editCard}
							role="none"
							onClick={(e) => e.stopPropagation()}
						>
							<div class={styles.editTitle}>
								修订{ed().role === "assistant" ? " AI 回复" : "消息"}
								<span class={styles.editHint}>原版本保留，修订后从此继续</span>
							</div>
							<textarea
								class={styles.editArea}
								value={c.editText()}
								onInput={(e) => c.setEditText(e.currentTarget.value)}
								rows={6}
							/>
							<div class={styles.editActions}>
								<button
									type="button"
									class={styles.btnGhost}
									onClick={() => c.setEditingNode(null)}
								>
									取消
								</button>
								<button
									type="button"
									class={styles.btnPrimary}
									disabled={!c.editText().trim()}
									onClick={() => void c.revise(ed().id, c.editText())}
								>
									保存修订
								</button>
							</div>
						</div>
					</div>
				)}
			</Show>
		</div>
	);
}

// ── 树列表项 ──

function TreeListItem(props: {
	tree: ChatTree;
	active: boolean;
	onSelect: () => void;
	onDelete: () => void;
}) {
	return (
		<div class={props.active ? styles.treeItemActive : styles.treeItem}>
			<button type="button" class={styles.treeSelect} onClick={props.onSelect}>
				<span class={styles.treeItemTitle}>{props.tree.title}</span>
				<span class={styles.treeItemMeta}>{props.tree.node_count} 条</span>
			</button>
			<button
				type="button"
				class={styles.treeDelete}
				title="删除对话"
				onClick={(e) => {
					e.stopPropagation();
					void props.onDelete();
				}}
			>
				✕
			</button>
		</div>
	);
}

// ── 树头部（标题 + 提示词管理） ──

function TreeHeader(props: {
	c: ReturnType<typeof useChatPage>;
	tree: ChatTree;
}) {
	const [showPrompt, setShowPrompt] = createSignal(false);
	const [promptText, setPromptText] = createSignal(props.tree.system_prompt);
	const [titleText, setTitleText] = createSignal(props.tree.title);

	const savePrompt = async () => {
		const ok = await import("@shared/lib").then((m) =>
			m.tryOrNotify(
				() =>
					import("@entities/chat").then((a) =>
						a.updateTreeE(props.tree.id, {
							system_prompt: promptText(),
							title: titleText(),
						}),
					),
				"保存设置",
			),
		);
		if (ok !== null) setShowPrompt(false);
	};

	return (
		<div class={styles.treeHeader}>
			<h2 class={styles.treeHeaderTitle}>{props.tree.title}</h2>
			<div class={styles.treeHeaderActions}>
				<button
					type="button"
					class={styles.promptBtn}
					onClick={() => {
						setPromptText(props.tree.system_prompt);
						setTitleText(props.tree.title);
						setShowPrompt(true);
					}}
				>
					设置
				</button>
			</div>
			<Show when={showPrompt()}>
				<div class={styles.promptPanel}>
					<label class={styles.promptLabel} for="chat-prompt-title">
						标题
					</label>
					<input
						id="chat-prompt-title"
						type="text"
						class={styles.promptInput}
						value={titleText()}
						onInput={(e) => setTitleText(e.currentTarget.value)}
					/>
					<label class={styles.promptLabel} for="chat-prompt-text">
						系统提示词（影响之后的对话）
					</label>
					<textarea
						id="chat-prompt-text"
						class={styles.promptTextarea}
						value={promptText()}
						onInput={(e) => setPromptText(e.currentTarget.value)}
						rows={3}
						placeholder="例如：你是一个严谨的代码导师…"
					/>
					<div class={styles.editActions}>
						<button
							type="button"
							class={styles.btnGhost}
							onClick={() => setShowPrompt(false)}
						>
							取消
						</button>
						<button
							type="button"
							class={styles.btnPrimary}
							onClick={() => void savePrompt()}
						>
							保存
						</button>
					</div>
				</div>
			</Show>
		</div>
	);
}

// ── 单条消息 ──

function MessageRow(props: {
	c: ReturnType<typeof useChatPage>;
	node: ChatNode;
}) {
	const { c, node } = props;
	const isFocused = () => c.focusId() === node.id;
	const children = () => c.childrenOf(node.id);
	const branchPoint = () => children().length > 1;
	const isUser = node.role === "user";

	const timeText = () => {
		const d = new Date(`${node.created_at.replace(" ", "T")}Z`);
		if (Number.isNaN(d.getTime())) return "";
		return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	};

	return (
		<div
			class={
				isUser
					? isFocused()
						? `${styles.messageRow} ${styles.userRow} ${styles.focused}`
						: `${styles.messageRow} ${styles.userRow}`
					: isFocused()
						? `${styles.messageRow} ${styles.assistantRow} ${styles.focused}`
						: `${styles.messageRow} ${styles.assistantRow}`
			}
		>
			{/* 头像（assistant 在左，user 在右） */}
			<Show when={!isUser}>
				<span class={styles.avatar} aria-hidden="true">
					AI
				</span>
			</Show>
			<div class={styles.messageCol}>
				<div class={styles.messageHead}>
					<span class={styles.messageRole}>
						{isUser ? "你" : "AI"}
						{node.revised_from !== null ? " · 修订" : ""}
					</span>
					<span class={styles.messageActions}>
						<span class={styles.messageTime}>{timeText()}</span>
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
					</span>
				</div>
				<div class={isUser ? styles.userBubble : styles.assistantBubble}>
					{isUser ? (
						node.content
					) : (
						<div class={styles.messageMd}>
							<MarkdownRenderer content={node.content} />
						</div>
					)}
				</div>

				{/* 分支切换：此节点有多个后续分支时显示切换条 */}
				<Show when={branchPoint()}>
					<div class={styles.branchBar}>
						<span class={styles.branchLabel}>分支</span>
						<For each={children()}>
							{(child) => (
								<button
									type="button"
									class={
										c.isInSubtree(child.id)
											? styles.branchChipActive
											: styles.branchChip
									}
									title="切换到该分支"
									onClick={() => c.focusBranch(child.id)}
								>
									{child.content.slice(0, 24) ||
										(child.role === "user" ? "继续提问" : "AI 回复")}
									{child.content.length > 24 ? "…" : ""}
								</button>
							)}
						</For>
					</div>
				</Show>
			</div>
		</div>
	);
}
