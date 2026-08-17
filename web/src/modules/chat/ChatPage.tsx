// ── 对话页：AI 多轮对话（树状分支 / 修订 / 搜索 / 预设提示词） ──

import { Button, Modal, SearchInput } from "@components/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import styles from "./ChatPage.module.css";
import {
	TocNav,
	ToggleSidebar,
	TreeHeader,
	TreeListItem,
	WelcomeText,
} from "./components/ChatPageParts.tsx";
import { Composer } from "./components/Composer.tsx";
import { MessageRow } from "./components/MessageRow.tsx";
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
					<SearchInput
						value={c.searchQ()}
						onSearch={(q) => c.onSearchInput(q)}
						debounceMs={0}
						placeholder="搜索对话 / 消息…"
						class={styles.searchInput}
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
							<ToggleSidebar
								collapsed={sidebarCollapsed()}
								onClick={() => setSidebarCollapsed(!sidebarCollapsed())}
							/>
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
							? "有什么想问的？Enter 换行，Shift+Enter 发送"
							: c.focusId() === null
								? "开始对话…（Enter 换行，Shift+Enter 发送）"
								: "继续对话…（Enter 换行，Shift+Enter 发送）"
					}
				/>
			</main>

			{/* ── 编辑弹层 ── */}
			<Modal
				isOpen={c.editingNode() !== null}
				onClose={() => c.setEditingNode(null)}
				title={`修订${
					c.editingNode()?.role === "assistant" ? " AI 回复" : "消息"
				}`}
				actions={
					<>
						<Button variant="secondary" onClick={() => c.setEditingNode(null)}>
							取消
						</Button>
						<Button
							variant="primary"
							disabled={!c.editText().trim()}
							onClick={() => void c.revise(c.editingNode()!.id, c.editText())}
						>
							保存修订
						</Button>
					</>
				}
			>
				<p class={styles.editHint}>原版本保留，修订后从此继续</p>
				<textarea
					class={styles.editArea}
					value={c.editText()}
					onInput={(e) => c.setEditText(e.currentTarget.value)}
					rows={6}
					aria-label="修订内容"
				/>
			</Modal>
		</div>
	);
}
