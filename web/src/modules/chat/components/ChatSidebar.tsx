// ── 对话侧边栏：/chat 与 /chat/mem 共用的树列表（同一主页面的两个分支） ──
// 统一提供：折叠、头部（返回链接 / 标题 / 新建）、提示文案、会话列表项。
// 列表项的操作（重命名 / AI 取标题 / 删除、悬浮三点菜单）由 TreeListItem 统一实现。

import type { ChatTree } from "@modules/chat";
import { A } from "@solidjs/router";
import { For, type JSX, Show } from "solid-js";
import { TreeListItem } from "./ChatPageParts.tsx";
import styles from "./ChatSidebar.module.css";

export interface ChatSidebarProps {
	trees: () => ChatTree[];
	loadingTrees: () => boolean;
	currentTreeId: () => number | null | undefined;
	collapsed: boolean;
	title: string;
	newLabel: string;
	emptyText: string;
	/** 侧边栏头部下方的提示文案（可选） */
	hint?: string;
	/** 头部左侧的返回链接（可选，如 /chat/mem 返回记忆页） */
	backHref?: string;
	backLabel?: string;
	/** 插入在侧边栏头部之前的内容（如 /chat 的搜索框） */
	preHead?: JSX.Element;
	onCreate: () => void;
	onSelect: (id: number) => void;
	onRename: (id: number, title: string) => void;
	onAiTitle: (id: number) => void;
	onDelete: (id: number) => void;
}

export function ChatSidebar(props: ChatSidebarProps) {
	return (
		<aside class={props.collapsed ? styles.sidebarCollapsed : styles.sidebar}>
			{props.preHead}
			<div class={styles.sidebarHead}>
				<span class={styles.sidebarHeadLeft}>
					<Show when={props.backHref}>
						<A href={props.backHref!} class={styles.sidebarBackLink}>
							{props.backLabel}
						</A>
					</Show>
					<span class={styles.sidebarTitle}>{props.title}</span>
				</span>
				<button type="button" class={styles.newBtn} onClick={props.onCreate}>
					{props.newLabel}
				</button>
			</div>
			<Show when={props.hint}>
				<div class={styles.sidebarHint}>{props.hint}</div>
			</Show>
			<div class={styles.treeList}>
				<For each={props.trees()}>
					{(tree) => (
						<TreeListItem
							tree={tree}
							active={props.currentTreeId() === tree.id}
							onSelect={() => props.onSelect(tree.id)}
							onRename={(title) => props.onRename(tree.id, title)}
							onAiTitle={() => props.onAiTitle(tree.id)}
							onDelete={() => props.onDelete(tree.id)}
						/>
					)}
				</For>
				<Show when={props.trees().length === 0 && !props.loadingTrees()}>
					<div class={styles.treeEmpty}>{props.emptyText}</div>
				</Show>
			</div>
		</aside>
	);
}

/** 侧边栏收起/展开按钮（由 ChatSidebar 配套提供） */
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
