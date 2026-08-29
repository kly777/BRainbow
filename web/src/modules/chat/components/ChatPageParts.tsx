// ── ChatPage 的子组件：树列表项 / 树头部（标题+提示词）/ 空会话欢迎区 / 章节导航 ──

import { Button } from "@components/ui";
import type { ChatNode, ChatTree } from "@modules/chat";
import { copyTextWithToast, fmtLocal, getGreeting, tryOrNotify } from "@shared/utils";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { updateTreeE } from "../api.ts";
import type { useChatPage } from "../hooks/useChatPage.ts";
import styles from "./ChatPageParts.module.css";

// ── 树列表项 ──

export function TreeListItem(props: {
	tree: ChatTree;
	active: boolean;
	onSelect: () => void;
	onRename: (title: string) => void;
	onAiTitle: () => void;
	onDelete: () => void;
}) {
	const [menuOpen, setMenuOpen] = createSignal(false);
	const [renaming, setRenaming] = createSignal(false);
	const [renameText, setRenameText] = createSignal(props.tree.title);
	const [aiBusy, setAiBusy] = createSignal(false);
	let menuRef!: HTMLDivElement;
	let renameRef!: HTMLInputElement;

	// 点击菜单外部关闭
	createEffect(() => {
		if (!menuOpen()) return;
		const onDown = (e: MouseEvent) => {
			const target = e.target;
			if (!(target instanceof Node) || !menuRef.contains(target)) {
				setMenuOpen(false);
			}
		};
		document.addEventListener("pointerdown", onDown);
		onCleanup(() => document.removeEventListener("pointerdown", onDown));
	});

	createEffect(() => {
		if (renaming()) renameRef?.focus();
	});

	const startRename = () => {
		setRenameText(props.tree.title);
		setRenaming(true);
		setMenuOpen(false);
	};

	const commitRename = () => {
		const title = renameText().trim();
		setRenaming(false);
		if (title && title !== props.tree.title) props.onRename(title);
	};

	const runAiTitle = async () => {
		setAiBusy(true);
		setMenuOpen(false);
		await props.onAiTitle();
		setAiBusy(false);
	};

	const timeText = () =>
		props.tree.updated_at ? fmtLocal(props.tree.updated_at) : "";

	return (
		<div class={props.active ? styles.treeItemActive : styles.treeItem}>
			<Show
				when={!renaming()}
				fallback={
					<input
						ref={renameRef}
						type="text"
						class={styles.treeRenameInput}
						value={renameText()}
						aria-label="重命名对话"
						onInput={(e) => setRenameText(e.currentTarget.value)}
						onClick={(e) => e.stopPropagation()}
						onBlur={commitRename}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Enter") commitRename();
							if (e.key === "Escape") {
								setRenameText(props.tree.title);
								setRenaming(false);
							}
						}}
					/>
				}
			>
				<button
					type="button"
					class={styles.treeSelect}
					onClick={() => {
						setMenuOpen(false);
						props.onSelect();
					}}
				>
					<span class={styles.treeItemTitle} title={props.tree.title}>
						{props.tree.title}
					</span>
					<span class={styles.treeItemTime}>{timeText()}</span>
				</button>
			</Show>
			<div class={styles.treeMoreWrap} ref={menuRef}>
				<button
					type="button"
					class={styles.treeMoreBtn}
					classList={{ [styles.treeMoreBtnOpen]: menuOpen() }}
					title="更多操作"
					aria-label="更多操作"
					aria-expanded={menuOpen()}
					onClick={(e) => {
						e.stopPropagation();
						setMenuOpen(!menuOpen());
					}}
				>
					•••
				</button>
				<Show when={menuOpen()}>
					<div class={styles.treeMenu}>
						<button
							type="button"
							class={styles.treeMenuItem}
							onClick={() => startRename()}
						>
							重命名
						</button>
						<button
							type="button"
							class={styles.treeMenuItem}
							disabled={aiBusy()}
							onClick={() => void runAiTitle()}
						>
							{aiBusy() ? "生成中…" : "AI 取标题"}
						</button>
						<button
							type="button"
							class={`${styles.treeMenuItem} ${styles.treeMenuItemDanger}`}
							onClick={() => {
								setMenuOpen(false);
								void props.onDelete();
							}}
						>
							删除
						</button>
					</div>
				</Show>
			</div>
		</div>
	);
}

// ── 树头部（标题 + 提示词管理） ──

export function TreeHeader(props: {
	c: ReturnType<typeof useChatPage>;
	tree: ChatTree;
}) {
	const [showPrompt, setShowPrompt] = createSignal(false);
	const [promptText, setPromptText] = createSignal(props.tree.system_prompt);

	const savePrompt = async () => {
		const ok = await tryOrNotify(
			() =>
				updateTreeE(props.tree.id, {
					system_prompt: promptText(),
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
						setShowPrompt(true);
					}}
				>
					设置
				</button>
			</div>
			<Show when={showPrompt()}>
				<div class={styles.promptPanel}>
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
						<Button variant="secondary" onClick={() => setShowPrompt(false)}>
							取消
						</Button>
						<Button variant="primary" onClick={() => void savePrompt()}>
							保存
						</Button>
					</div>
				</div>
			</Show>
		</div>
	);
}

// ── 空会话欢迎区：时段问候 + 接地各模块的示例问题（输入框恒定在底部） ──

const SAMPLE_PROMPTS = [
	"总结我近期的任务，标出今天要做的",
	"把我的知识卡片整理成一份复习计划",
	"用通俗的语言解释 FSRS 间隔重复算法",
	"帮我拆解一句英语长难句的结构",
];

export function WelcomeText(props: {
	title: string;
	onPick: (text: string) => void;
}) {
	return (
		<div class={styles.welcome}>
			<h1 class={styles.welcomeTitle}>{getGreeting()}</h1>
			<p class={styles.welcomeContext}>{props.title}</p>
			<div class={styles.welcomeSamples}>
				<For each={SAMPLE_PROMPTS}>
					{(prompt, i) => (
						<button
							type="button"
							class={styles.welcomeChip}
							style={{ "animation-delay": `${120 + i() * 60}ms` }}
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

export function TocNav(props: {
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

/** 复制节点内容（消息操作按钮） */
export function copyNode(node: ChatNode) {
	return copyTextWithToast(node.content);
}
