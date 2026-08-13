// ── 分支切换条：某节点有多个后续分支时显示 ──

import type { ChatNode } from "@modules/chat";
import { For } from "solid-js";

/** 所需样式类：branchBar/branchLabel/branchChip/branchChipActive */
export type BranchBarStyles = Record<string, string>;

export function BranchBar(props: {
	styles: BranchBarStyles;
	children: ChatNode[];
	isActive: (id: number) => boolean;
	onSelect: (id: number) => void;
	/** 切换按钮提示文案 */
	title: string;
	/** 分支标签文本（缺省：内容前 24 字 + 角色兜底） */
	chipText?: (node: ChatNode) => string;
}) {
	const text = (node: ChatNode) => {
		if (props.chipText) return props.chipText(node);
		return (
			node.content.slice(0, 24) ||
			(node.role === "user" ? "继续提问" : "AI 回复")
		);
	};

	return (
		<div class={props.styles.branchBar}>
			<span class={props.styles.branchLabel}>分支</span>
			<For each={props.children}>
				{(child) => (
					<button
						type="button"
						class={
							props.isActive(child.id)
								? props.styles.branchChipActive
								: props.styles.branchChip
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
