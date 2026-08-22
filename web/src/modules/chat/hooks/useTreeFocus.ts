// ── URL 驱动的焦点/分支导航 ──
// 从 useChatSession 拆分：节点查找、活跃路径、分支切换、子树判断。

import type { ChatNode } from "@modules/chat";
import type { Accessor } from "solid-js";
import {
	computeActivePath,
	findBranchLeaf,
	isNodeInSubtree,
} from "./chat-tree.ts";

export interface UseTreeFocusOpts {
	nodes: Accessor<ChatNode[]>;
	/** 聚焦节点 id（由 URL node 参数驱动） */
	focusId: Accessor<number | null>;
	setFocusParam: (id: number | null) => void;
}

export function useTreeFocus(opts: UseTreeFocusOpts) {
	const childrenOf = (parentId: number | null) =>
		opts.nodes().filter((n) => n.parent_id === parentId);

	/** 从树中找节点 */
	const findNode = (id: number | null): ChatNode | undefined =>
		id === null ? undefined : opts.nodes().find((n) => n.id === id);

	/** 聚焦节点（或最新节点）到根的路径（父在前） */
	const activePath = (): ChatNode[] =>
		computeActivePath(opts.nodes(), opts.focusId());

	/** 当前分支末端节点（新消息挂载点） */
	const lastNode = () => {
		const p = activePath();
		return p.length > 0 ? p[p.length - 1] : null;
	};

	/** 切换分支：跳到该节点所在分支的末端 */
	const focusBranch = (branchRootId: number) =>
		opts.setFocusParam(findBranchLeaf(opts.nodes(), branchRootId));

	/** 当前分支是否经过某节点（分支条高亮） */
	const isInSubtree = (rootId: number): boolean =>
		isNodeInSubtree(opts.nodes(), opts.focusId(), rootId);

	return {
		childrenOf,
		findNode,
		activePath,
		lastNode,
		focusBranch,
		isInSubtree,
	};
}
