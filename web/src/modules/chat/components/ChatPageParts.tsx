// ── ChatPage 的子组件：树列表项 / 树头部（标题+提示词）/ 空会话欢迎区 / 章节导航 ──

import { notifyError, notifySuccess, tryOrNotify } from "@lib/utils";
import type { ChatNode, ChatTree } from "@modules/chat";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { updateTreeE } from "../api.ts";
import styles from "../ChatPage.module.css";
import type { useChatPage } from "../hooks/useChatPage.ts";

// ── 树列表项 ──

/** 侧边栏收起/展开按钮 */
export function ToggleSidebar(props: {
	collapsed: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			class={styles.sidebarToggle}
			title={props.collapsed ? "展开侧边栏" : "收起侧边栏"}
			onClick={props.onClick}
		>
			{props.collapsed ? "☰" : "◀"}
		</button>
	);
}

export function TreeListItem(props: {
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

export function TreeHeader(props: {
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

// ── 空会话欢迎区：居中文案 + 示例问题（输入框恒定在底部） ──

const SAMPLE_PROMPTS = [
	"总结一下我的任务清单",
	"解释什么是间隔重复记忆",
	"帮我梳理一个学习计划",
	"用通俗的语言讲讲 FSRS 算法",
];

export function WelcomeText(props: {
	title: string;
	onPick: (text: string) => void;
}) {
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
export async function copyNode(node: ChatNode) {
	try {
		await navigator.clipboard.writeText(node.content);
		notifySuccess("已复制");
	} catch {
		notifyError("复制失败");
	}
}
