// ── 对话树纯函数：路径计算 / 分支末端 / 子树判断（无 Solid 依赖，便于单测） ──

import type { ChatNode } from "@modules/chat";

/** 聚焦节点（或最新节点）到根的路径（父在前） */
export function computeActivePath(
	all: ChatNode[],
	focusId: number | null,
): ChatNode[] {
	if (all.length === 0) return [];
	const anchor =
		focusId !== null && all.some((n) => n.id === focusId)
			? focusId
			: all[all.length - 1].id;
	const chain: ChatNode[] = [];
	let cur: ChatNode | undefined = all.find((n) => n.id === anchor);
	let guard = 0;
	while (cur !== undefined && guard < 200) {
		guard++;
		chain.unshift(cur);
		cur =
			cur.parent_id === null
				? undefined
				: all.find((n) => n.id === cur!.parent_id);
	}
	return chain;
}

/** 分支末端节点 id：沿最新子链走到最深叶子 */
export function findBranchLeaf(all: ChatNode[], branchRootId: number): number {
	let cur = branchRootId;
	let guard = 0;
	while (guard < 500) {
		const kids = all.filter((n) => n.parent_id === cur);
		if (kids.length === 0) break;
		cur = kids[kids.length - 1].id;
		guard++;
	}
	return cur;
}

/** focusId 所在分支是否经过 rootId（分支条高亮判断） */
export function isNodeInSubtree(
	all: ChatNode[],
	focusId: number | null,
	rootId: number,
): boolean {
	let cur = focusId;
	let guard = 0;
	while (cur !== null && guard < 500) {
		if (cur === rootId) return true;
		cur = all.find((n) => n.id === cur)?.parent_id ?? null;
		guard++;
	}
	return false;
}

/** 创建本地临时节点（负数 id 标记乐观插入，完成后被真实节点替换） */
export function makeTempNode(
	id: number,
	parentId: number | null,
	role: "user" | "assistant",
	content: string,
	treeId: number,
): ChatNode {
	return {
		id,
		tree_id: treeId,
		parent_id: parentId,
		role,
		content,
		revised_from: null,
		created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
	};
}
