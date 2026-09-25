// ── 对话侧边栏：/chat 与 /chat/mem 共用的树列表（同一主页面的两个分支） ──
// 统一提供：折叠、头部（返回链接 / 标题 / 新建）、提示文案、会话列表项。
// 列表项的操作（重命名 / AI 取标题 / 删除、悬浮三点菜单）由 TreeListItem 统一实现。

import { EmptyState } from "@components/ui";
import { A } from "@solidjs/router";
import { For, type JSX, Show } from "solid-js";
import type { ChatTree } from "../api.ts";
import { TreeListItem } from "./ChatPageParts.tsx";
import styles from "./ChatSidebar.module.css";

/** 侧边栏的文案（两个入口页面各写一套，故收成一束） */
export interface SidebarCopy {
	title: string;
	newLabel: string;
	emptyText: string;
	/** 侧边栏头部下方的提示文案（可选） */
	hint?: string;
}

/** 头部与插入内容（都是"壳"，由页面给） */
export interface SidebarSlots {
	/** 头部左侧的返回链接（可选，如 /chat/mem 返回记忆页） */
	backHref?: string;
	backLabel?: JSX.Element;
	/** 插入在侧边栏头部之前的内容（如 /chat 的搜索框） */
	preHead?: JSX.Element;
}

/** 会话操作收成一束（刀法 ②）：加一个操作只改这里与两个调用点 */
export interface SidebarActions {
	onCreate: () => void;
	onSelect: (id: number) => void;
	onRename: (id: number, title: string) => void;
	onAiTitle: (id: number) => void;
	onDelete: (id: number) => void;
}

export interface ChatSidebarProps {
	trees: () => ChatTree[];
	loadingTrees: () => boolean;
	currentTreeId: () => number | null | undefined;
	collapsed: boolean;
	copy: SidebarCopy;
	slots: SidebarSlots;
	actions: SidebarActions;
}

export function ChatSidebar(props: ChatSidebarProps) {
	return (
		<aside class={props.collapsed ? styles.sidebarCollapsed : styles.sidebar}>
			{props.slots.preHead}
			<div class={styles.sidebarHead}>
				<span class={styles.sidebarHeadLeft}>
					<Show when={props.slots.backHref}>
						{(href) => (
							<A href={href()} class={styles.sidebarBackLink}>
								{props.slots.backLabel}
							</A>
						)}
					</Show>
					<span class={styles.sidebarTitle}>{props.copy.title}</span>
				</span>
				<button
					type="button"
					class={styles.newBtn}
					onClick={props.actions.onCreate}
				>
					{props.copy.newLabel}
				</button>
			</div>
			<Show when={props.copy.hint}>
				<div class={styles.sidebarHint}>{props.copy.hint}</div>
			</Show>
			<div class={styles.treeList}>
				<For each={props.trees()}>
					{(tree) => (
						<TreeListItem
							tree={tree}
							active={props.currentTreeId() === tree.id}
							onSelect={() => props.actions.onSelect(tree.id)}
							onRename={(title) => props.actions.onRename(tree.id, title)}
							onAiTitle={() => props.actions.onAiTitle(tree.id)}
							onDelete={() => props.actions.onDelete(tree.id)}
						/>
					)}
				</For>
				<Show when={props.loadingTrees()}>
					<div class={styles.treeSkeleton} aria-hidden="true">
						<div class={`skeleton ${styles.skRow}`} />
						<div class={`skeleton ${styles.skRow}`} />
						<div class={`skeleton ${styles.skRow}`} />
						<div class={`skeleton ${styles.skRow}`} />
					</div>
				</Show>
				<Show when={props.trees().length === 0 && !props.loadingTrees()}>
					<EmptyState title={props.copy.emptyText} compact />
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
			aria-label={props.collapsed ? "展开侧边栏" : "收起侧边栏"}
			onClick={props.onClick}
		>
			<svg
				viewBox="0 0 24 24"
				width="14"
				height="14"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<Show
					when={props.collapsed}
					fallback={<polyline points="15 18 9 12 15 6" />}
				>
					<path d="M3 5h18M3 12h18M3 19h18" />
				</Show>
			</svg>
		</button>
	);
}
