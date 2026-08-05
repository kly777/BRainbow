// ── 依赖图布局引擎（纯函数，无外部依赖） ──

import type { DagEdge, DagNode } from "@features/task/types.ts";

/** 带布局坐标的节点 */
export interface LayoutNode {
	id: number;
	title: string;
	status: string;
	x: number;
	y: number;
}

/** 带源/目标坐标的边 */
export interface LayoutEdge {
	from: number;
	to: number;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

/** 拓扑排序 + 分层，返回节点坐标和边 */
export function layout(
	nodes: readonly DagNode[],
	edges: readonly DagEdge[],
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
	// 构建邻接表和入度
	const adj = new Map<number, number[]>();
	const inDeg = new Map<number, number>();
	for (const n of nodes) {
		adj.set(n.id, []);
		inDeg.set(n.id, 0);
	}
	for (const e of edges) {
		const list = adj.get(e.from) || [];
		list.push(e.to);
		adj.set(e.from, list);
		inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
	}

	// 入度为 0 的作为第一层
	const layers: number[][] = [];
	let queue: number[] = [];
	for (const [id, deg] of inDeg) {
		if (deg === 0) queue.push(id);
	}

	while (queue.length > 0) {
		layers.push([...queue]);
		const next: number[] = [];
		for (const id of queue) {
			for (const to of adj.get(id) || []) {
				const d = (inDeg.get(to) || 1) - 1;
				inDeg.set(to, d);
				if (d === 0) next.push(to);
			}
		}
		queue = next;
	}

	// 处理孤立节点：放入最后一层
	const placed = new Set(layers.flat());
	const orphans: number[] = [];
	for (const n of nodes) {
		if (!placed.has(n.id)) orphans.push(n.id);
	}
	if (orphans.length > 0) layers.push(orphans);

	// 计算坐标
	const layerGap = 280;
	const nodeGap = 60;
	const marginX = 140;
	const marginY = 50;

	const positions = new Map<number, { x: number; y: number }>();
	for (let li = 0; li < layers.length; li++) {
		const layer = layers[li];
		const totalHeight = (layer.length - 1) * nodeGap;
		const startY = marginY + (li % 2 === 0 ? 0 : nodeGap / 2);
		for (let ni = 0; ni < layer.length; ni++) {
			const y = startY + ni * nodeGap - totalHeight / 2;
			positions.set(layer[ni], {
				x: marginX + li * layerGap,
				y: y + 200,
			});
		}
	}

	// 生成布局节点和边
	const layoutNodes: LayoutNode[] = nodes.map((n) => {
		const pos = positions.get(n.id) || { x: marginX, y: 200 };
		return {
			id: n.id,
			title: n.title,
			status: n.status,
			x: pos.x,
			y: pos.y,
		};
	});

	const layoutEdges: LayoutEdge[] = edges
		.filter((e) => positions.has(e.from) && positions.has(e.to))
		.map((e) => {
			const f = positions.get(e.from);
			const t = positions.get(e.to);
			if (!f || !t) return null;
			return {
				from: e.from,
				to: e.to,
				x1: f.x,
				y1: f.y,
				x2: t.x,
				y2: t.y,
			};
		})
		.filter(Boolean) as LayoutEdge[];

	return { nodes: layoutNodes, edges: layoutEdges };
}
