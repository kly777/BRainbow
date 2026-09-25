// ── 分支切换条：某节点有多个后续分支时显示 ──

import { For } from "solid-js";
import type { ChatNode } from "../api.ts";
import pageStyles from "./BranchBar.module.css";
import memStyles from "./BranchBarMem.module.css";
import { PREVIEW_LEN } from "./preview.ts";

export function BranchBar(props: {
	children: ChatNode[];
	isActive: (id: number) => boolean;
	onSelect: (id: number) => void;
	/** 切换按钮提示文案 */
	title: string;
	/** 分支标签文本（缺省：内容前 24 字 + 角色兜底） */
	chipText?: (node: ChatNode) => string;
	/** 会话页/记忆页视觉变体 */
	variant?: "page" | "mem";
}) {
	const styles = props.variant === "mem" ? memStyles : pageStyles;
	const text = (node: ChatNode) => {
		if (props.chipText) return props.chipText(node);
		return (
			node.content.slice(0, PREVIEW_LEN) ||
			(node.role === "user" ? "继续提问" : "AI 回复")
		);
	};

	return (
		<div class={styles.branchBar}>
			<span class={styles.branchLabel}>分支</span>
			<For each={props.children}>
				{(child) => (
					<button
						type="button"
						class={
							props.isActive(child.id)
								? styles.branchChipActive
								: styles.branchChip
						}
						title={props.title}
						onClick={() => props.onSelect(child.id)}
					>
						{text(child)}
						{child.content.length > 24 ? "…" : ""}
					</button>
				)}
			</For>
		</div>
	);
}
