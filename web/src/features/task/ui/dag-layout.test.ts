import { describe, expect, it } from "vitest";
import { layout } from "./dag-layout.ts";
import type { DagNode, DagEdge } from "../types.ts";

describe("layout", () => {
	it("empty nodes → empty result", () => {
		const result = layout([], []);
		expect(result.nodes).toEqual([]);
		expect(result.edges).toEqual([]);
	});

	it("single node → placed at layer 0", () => {
		const nodes: DagNode[] = [{ id: 1, title: "A", status: "backlog" }];
		const result = layout(nodes, []);
		expect(result.nodes).toHaveLength(1);
		expect(result.nodes[0].id).toBe(1);
		expect(result.nodes[0].title).toBe("A");
		expect(result.nodes[0].status).toBe("backlog");
		expect(result.nodes[0].x).toBeGreaterThan(0);
		expect(result.nodes[0].y).toBeGreaterThan(0);
	});

	it("two independent nodes → same layer", () => {
		const nodes: DagNode[] = [
			{ id: 1, title: "A", status: "backlog" },
			{ id: 2, title: "B", status: "backlog" },
		];
		const result = layout(nodes, []);
		expect(result.nodes).toHaveLength(2);
		// 同层 y 不同
		expect(result.nodes[0].y).not.toBe(result.nodes[1].y);
	});

	it("chain A→B→C → 3 layers", () => {
		const nodes: DagNode[] = [
			{ id: 1, title: "A", status: "backlog" },
			{ id: 2, title: "B", status: "active" },
			{ id: 3, title: "C", status: "completed" },
		];
		const edges: DagEdge[] = [
			{ from: 1, to: 2 },
			{ from: 2, to: 3 },
		];
		const result = layout(nodes, edges);
		expect(result.nodes).toHaveLength(3);
		expect(result.edges).toHaveLength(2);
		// A (id=1) 应该在 B 左边 (x 更小)
		const n1 = result.nodes.find((n) => n.id === 1)!;
		const n2 = result.nodes.find((n) => n.id === 2)!;
		const n3 = result.nodes.find((n) => n.id === 3)!;
		expect(n1.x).toBeLessThan(n2.x);
		expect(n2.x).toBeLessThan(n3.x);
	});

	it("diamond A→B, A→C, B→D, C→D", () => {
		const nodes: DagNode[] = [
			{ id: 1, title: "A", status: "backlog" },
			{ id: 2, title: "B", status: "active" },
			{ id: 3, title: "C", status: "active" },
			{ id: 4, title: "D", status: "completed" },
		];
		const edges: DagEdge[] = [
			{ from: 1, to: 2 },
			{ from: 1, to: 3 },
			{ from: 2, to: 4 },
			{ from: 3, to: 4 },
		];
		const result = layout(nodes, edges);
		expect(result.nodes).toHaveLength(4);
		expect(result.edges).toHaveLength(4);
		// A 是最左边, D 是最右边
		const n1 = result.nodes.find((n) => n.id === 1)!;
		const n4 = result.nodes.find((n) => n.id === 4)!;
		expect(n1.x).toBeLessThan(n4.x);
	});

	it("edge to non-existent node appears in output (layoutNodes only maps original nodes)", () => {
		// layoutNodes 由原始 nodes.map 生成，不会加入边引用的未知节点
		// 但该节点有 position（拓扑排序加入），所以 edge 过滤通过
		const nodes: DagNode[] = [
			{ id: 1, title: "A", status: "backlog" },
		];
		const edges: DagEdge[] = [{ from: 1, to: 999 }];
		const result = layout(nodes, edges);
		expect(result.nodes).toHaveLength(1);
		expect(result.edges).toHaveLength(1);
		expect(result.edges[0].to).toBe(999);
	});

	it("preserves all node attributes in output", () => {
		const nodes: DagNode[] = [
			{ id: 42, title: "Hello World", status: "completed" },
		];
		const result = layout(nodes, []);
		expect(result.nodes[0]).toMatchObject({
			id: 42,
			title: "Hello World",
			status: "completed",
		});
	});
});
