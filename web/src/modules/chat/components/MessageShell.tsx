// ── 消息骨架：头像 / 头部（角色·时间·操作）/ 内容体 / 底部（分支条）──
// /chat 与 /chat/mem 共用；样式由调用方注入（两页面 CSS 有细微差异）。

import { fmtHm } from "@shared/utils";
import { type JSX, Show } from "solid-js";
import type { ChatNode } from "../api.ts";

/** 所需样式类：messageRow/userRow/assistantRow/avatar/messageCol/messageHead/messageRole/messageActions/messageTime */
export type MessageShellStyles = Record<string, string>;

export function MessageShell(props: {
	styles: MessageShellStyles;
	node: ChatNode;
	/** 追加到行上的类（如聚焦高亮） */
	rowClass?: string;
	/** 角色名后的附加标记（如"· 修订"） */
	headExtra?: JSX.Element;
	/** 头部右侧操作按钮（修订 / 重新生成） */
	actions?: JSX.Element;
	/** 时间戳在操作按钮之前（默认之后） */
	timeFirst?: boolean;
	/** 消息内容体（user 文本 / assistant Markdown / 卡片清单） */
	children: JSX.Element;
	/** 内容体下方（分支切换条） */
	footer?: JSX.Element;
}) {
	const { styles, node } = props;
	const isUser = () => node.role === "user";

	const timeText = () => fmtHm(node.created_at);

	const rowClass = () =>
		[
			styles.messageRow,
			isUser() ? styles.userRow : styles.assistantRow,
			props.rowClass,
		]
			.filter(Boolean)
			.join(" ");

	return (
		<div class={rowClass()}>
			<Show when={!isUser()}>
				<span class={styles.avatar} aria-hidden="true">
					AI
				</span>
			</Show>
			<div class={styles.messageCol}>
				<div class={styles.messageHead}>
					<span class={styles.messageRole}>
						{isUser() ? "你" : "AI"}
						{props.headExtra}
					</span>
					<span class={styles.messageActions}>
						{props.timeFirst && (
							<span class={styles.messageTime}>{timeText()}</span>
						)}
						{props.actions}
						{!props.timeFirst && (
							<span class={styles.messageTime}>{timeText()}</span>
						)}
					</span>
				</div>
				{props.children}
				{props.footer}
			</div>
		</div>
	);
}
