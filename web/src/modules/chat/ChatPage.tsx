// ── 对话页：AI 多轮对话（树状分支 / 修订 / 搜索 / 预设提示词） ──

import { Markdown as MarkdownRenderer } from "@components/ui";
import { notifyError, notifySuccess, tryOrNotify } from "@lib/utils";
import type { ChatNode, ChatTree } from "@modules/chat";
import {
	createEffect,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { updateTreeE } from "./api.ts";
import styles from "./ChatPage.module.css";
import { BranchBar } from "./components/BranchBar.tsx";
import { Composer } from "./components/Composer.tsx";
import { MessageShell } from "./components/MessageShell.tsx";
import { ThinkingBlock } from "./components/ThinkingBlock.tsx";
import { useAutoScroll } from "./hooks/useAutoScroll.ts";
import { useChatPage } from "./hooks/useChatPage.ts";

export default function ChatPage() {
	const c = useChatPage();
	const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
	let listRef: HTMLDivElement | undefined;
	const autoScroll = useAutoScroll(() => listRef);
	autoScroll.follow(() => c.activePath());

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
						onClick={() => void c.createSession()}
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
								onSelect={() => c.selectSession(tree.id)}
								onDelete={() => c.removeSession(tree.id)}
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
					when={
						c.current() !== null && c.activePath().length > 0
							? c.current()
							: null
					}
					fallback={
						<WelcomeText
							title={
								c.current()?.tree.title === "新对话"
									? "AI 对话工作台"
									: (c.current()?.tree.title ?? "AI 对话工作台")
							}
							onPick={(text) => c.setInput(text)}
						/>
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
							<div class={styles.messageList} ref={listRef}>
								<For each={c.activePath()}>
									{(node) => <MessageRow c={c} node={node} />}
								</For>
							</div>
							<TocNav container={() => listRef} dep={() => c.activePath()} />
						</>
					)}
				</Show>
				<Composer
					styles={styles}
					sending={c.sending}
					input={c.input}
					onInput={c.setInput}
					onSend={() => void c.send()}
					onStop={() => c.stopStreaming()}
					placeholder={() =>
						c.activePath().length === 0
							? "有什么想问的？Enter 发送，Shift+Enter 换行"
							: c.focusId() === null
								? "开始对话…（Enter 发送，Shift+Enter 换行）"
								: "继续对话…（将追加到当前消息之后）"
					}
				/>
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
		const ok = await tryOrNotify(
			() =>
				updateTreeE(props.tree.id, {
					system_prompt: promptText(),
					title: titleText(),
				}),
			"保存设置",
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

async function copyNode(node: ChatNode) {
	try {
		await navigator.clipboard.writeText(node.content);
		notifySuccess("已复制");
	} catch {
		notifyError("复制失败");
	}
}

function MessageRow(props: {
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
			rowClass={[
				isFocused() ? styles.focused : undefined,
				streaming() ? styles.streamingRow : undefined,
			]
				.filter(Boolean)
				.join(" ")}
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
						styles={styles}
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
							styles={styles}
							reasoning={() => node.reasoning}
							done={() => !!node.content}
							open={streaming()}
						/>
						<Show
							when={node.content}
							fallback={<span class={styles.thinking}>思考中…</span>}
						>
							<MarkdownRenderer content={node.content} />
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

// ── 空会话欢迎区：居中文案 + 示例问题（输入框恒定在底部） ──

const SAMPLE_PROMPTS = [
	"总结一下我的任务清单",
	"解释什么是间隔重复记忆",
	"帮我梳理一个学习计划",
	"用通俗的语言讲讲 FSRS 算法",
];

function WelcomeText(props: { title: string; onPick: (text: string) => void }) {
	return (
		<div class={styles.welcome}>
			<h1 class={styles.welcomeTitle}>{props.title}</h1>
			<p class={styles.welcomeHint}>
				支持多轮对话、树状分支、修订上下文；AI 思考过程可折叠查看。
			</p>
			<div class={styles.welcomeSamples}>
				<For each={SAMPLE_PROMPTS}>
					{(prompt) => (
						<button
							type="button"
							class={styles.welcomeChip}
							onClick={() => props.onPick(prompt)}
						>
							{prompt}
						</button>
					)}
				</For>
			</div>
		</div>
	);
}

// ── 右侧章节导航（DeepSeek 风格）：扫描消息中的标题，点击定位 ──

interface TocHeading {
	el: HTMLElement;
	text: string;
	level: number;
}

function TocNav(props: {
	container: () => HTMLElement | undefined;
	/** 依赖项（activePath）：消息流变化时重新扫描 */
	dep: () => unknown;
}) {
	const [headings, setHeadings] = createSignal<TocHeading[]>([]);
	const [activeIdx, setActiveIdx] = createSignal(-1);

	createEffect(() => {
		void props.dep();
		// 等 DOM 更新后扫描（流式渲染 + 标题 id 增强）
		queueMicrotask(() => {
			const el = props.container();
			if (!el) {
				setHeadings([]);
				return;
			}
			const items = [...el.querySelectorAll<HTMLElement>("[id^='md-h-']")].map(
				(h) => ({
					el: h,
					text: (h.textContent ?? "").trim().slice(0, 40),
					level: Number(h.tagName[1]),
				}),
			);
			setHeadings(items);
			setActiveIdx(-1);
		});
	});

	// 滚动高亮当前章节（IntersectionObserver 跟随）
	let observer: IntersectionObserver | undefined;
	createEffect(() => {
		const list = headings();
		if (list.length === 0) return;
		observer?.disconnect();
		observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (visible.length > 0) {
					const idx = list.findIndex((h) => h.el === visible[0].target);
					if (idx >= 0) setActiveIdx(idx);
				}
			},
			{ rootMargin: "-80px 0px -70% 0px", threshold: 0 },
		);
		for (const h of list) observer.observe(h.el);
		onCleanup(() => observer?.disconnect());
	});

	const scrollTo = (h: TocHeading, idx: number) => {
		setActiveIdx(idx);
		h.el.scrollIntoView({ behavior: "smooth", block: "start" });
	};

	return (
		<Show when={headings().length > 0}>
			<nav class={styles.toc} aria-label="章节导航">
				<span class={styles.tocTitle}>本页目录</span>
				<div class={styles.tocList}>
					<For each={headings()}>
						{(h, i) => (
							<button
								type="button"
								class={styles.tocItem}
								classList={{
									[styles.tocItemL2]: h.level === 2,
									[styles.tocItemL3]: h.level === 3,
									[styles.tocItemActive]: i() === activeIdx(),
								}}
								onClick={() => scrollTo(h, i())}
							>
								{h.text}
							</button>
						)}
					</For>
				</div>
			</nav>
		</Show>
	);
}
