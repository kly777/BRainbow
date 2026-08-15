import type { ChatNode } from "@modules/chat";
import { describe, expect, it } from "vitest";
import {
	computeActivePath,
	findBranchLeaf,
	isNodeInSubtree,
	makeTempNode,
} from "./chat-tree.ts";

function node(id: number, parentId: number | null): ChatNode {
	return {
		id,
		tree_id: 1,
		parent_id: parentId,
		role: "assistant",
		content: `n${id}`,
		revised_from: null,
		created_at: "2026-01-01 00:00:00",
	};
}

describe("chat-tree 纯函数", () => {
	it("computeActivePath 从根到聚焦节点（父在前）", () => {
		const root = node(1, null);
		const mid = node(2, 1);
		const focus = node(3, 2);
		const path = computeActivePath([root, mid, focus], 3);
		expect(path.map((n) => n.id)).toEqual([1, 2, 3]);
	});

	it("computeActivePath 聚焦不存在的节点时回退到最后一个节点", () => {
		const root = node(1, null);
		const last = node(2, 1);
		const path = computeActivePath([root, last], 999);
		expect(path.map((n) => n.id)).toEqual([1, 2]);
	});

	it("findBranchLeaf 沿最新子链走到最深叶子", () => {
		const root = node(1, null);
		const a = node(2, 1);
		const b = node(3, 1); // 最新子
		const leaf = node(4, 3);
		expect(findBranchLeaf([root, a, b, leaf], 1)).toBe(4);
	});

	it("isNodeInSubtree 判断分支祖先关系", () => {
		const root = node(1, null);
		const branchA = node(2, 1);
		const branchB = node(3, 1);
		const leaf = node(4, 3);

		expect(isNodeInSubtree([root, branchA, branchB, leaf], 4, 1)).toBe(true);
		expect(isNodeInSubtree([root, branchA, branchB, leaf], 4, 3)).toBe(true);
		expect(isNodeInSubtree([root, branchA, branchB, leaf], 4, 2)).toBe(false);
		expect(isNodeInSubtree([root, branchA, branchB, leaf], null, 1)).toBe(
			false,
		);
	});

	it("makeTempNode 使用负数 id 标记乐观插入", () => {
		const temp = makeTempNode(-123, 1, "assistant", "hi", 7);
		expect(temp.id).toBe(-123);
		expect(temp.parent_id).toBe(1);
		expect(temp.tree_id).toBe(7);
		expect(temp.content).toBe("hi");
	});
});
