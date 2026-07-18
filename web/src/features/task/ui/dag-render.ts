// ── 依赖图 Canvas 渲染 ──

import type { LayoutEdge, LayoutNode } from "./dag-layout.ts";

/** CSS 变量缓存 */
const _cssCache = new Map<string, string>();

function readCSSVar(name: string): string {
	const cached = _cssCache.get(name);
	if (cached !== undefined) return cached;
	const style = getComputedStyle(document.documentElement);
	const val = style.getPropertyValue(name).trim();
	_cssCache.set(name, val);
	return val;
}

const STATUS_COLORS: Record<string, string> = {
	backlog: "var(--color-text-muted)",
	active: "var(--color-accent)",
	completed: "var(--color-success)",
	archived: "var(--color-text-secondary)",
};

function statusColor(s: string): string {
	const v = STATUS_COLORS[s];
	if (!v) return readCSSVar("--color-text-muted");
	return v.startsWith("var(") ? readCSSVar(v.slice(4, -1)) : v;
}

/** 在 Canvas 上绘制 DAG */
export function drawGraph(
	ctx: CanvasRenderingContext2D,
	lay: { nodes: LayoutNode[]; edges: LayoutEdge[] },
	scale: number,
	offsetX: number,
	offsetY: number,
	hoveredId: number | null,
) {
	const w = ctx.canvas.width;
	const h = ctx.canvas.height;
	ctx.clearRect(0, 0, w, h);
	ctx.save();
	ctx.translate(offsetX, offsetY);
	ctx.scale(scale, scale);

	// 边
	for (const e of lay.edges) {
		const dx = e.x2 - e.x1;
		const dy = e.y2 - e.y1;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len === 0) continue;

		ctx.beginPath();
		ctx.moveTo(e.x1, e.y1);
		ctx.lineTo(e.x2 - (dx / len) * 32, e.y2 - (dy / len) * 32);
		ctx.strokeStyle = readCSSVar("--color-border");
		ctx.lineWidth = 2;
		ctx.stroke();

		// 箭头
		const angle = Math.atan2(dy, dx);
		const arrowLen = 8;
		const ax = e.x2 - (dx / len) * 32;
		const ay = e.y2 - (dy / len) * 32;
		ctx.beginPath();
		ctx.moveTo(ax, ay);
		ctx.lineTo(
			ax - arrowLen * Math.cos(angle - Math.PI / 6),
			ay - arrowLen * Math.sin(angle - Math.PI / 6),
		);
		ctx.lineTo(
			ax - arrowLen * Math.cos(angle + Math.PI / 6),
			ay - arrowLen * Math.sin(angle + Math.PI / 6),
		);
		ctx.closePath();
		ctx.fillStyle = readCSSVar("--color-border");
		ctx.fill();
	}

	// 节点
	for (const n of lay.nodes) {
		const r = 28;
		const isHovered = hoveredId === n.id;

		// 阴影
		ctx.beginPath();
		ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
		ctx.fillStyle = isHovered ? "oklch(0 0 0 / 0.15)" : "oklch(0 0 0 / 0.08)";
		ctx.fill();

		// 圆
		ctx.beginPath();
		ctx.arc(n.x, n.y, r - 2, 0, Math.PI * 2);
		ctx.fillStyle = statusColor(n.status);
		ctx.fill();
		ctx.strokeStyle = isHovered
			? readCSSVar("--color-text")
			: readCSSVar("--color-white");
		ctx.lineWidth = 2;
		ctx.stroke();

		// 文字
		const text = n.title.length > 6 ? `${n.title.slice(0, 5)}…` : n.title;
		ctx.fillStyle = readCSSVar("--color-white");
		ctx.font = `${isHovered ? "bold " : ""}10px sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(text, n.x, n.y);

		// hover 时显示完整标题
		if (isHovered) {
			ctx.fillStyle = readCSSVar("--color-text");
			ctx.font = "12px sans-serif";
			ctx.fillText(n.title, n.x, n.y - r - 12);
		}
	}

	// 图例
	ctx.restore();
	ctx.fillStyle = readCSSVar("--color-text-secondary");
	ctx.font = "11px sans-serif";
	ctx.textAlign = "left";

	const legend = [
		{ label: "● 待办", color: statusColor("backlog") },
		{ label: "● 进行中", color: statusColor("active") },
		{ label: "● 已完成", color: statusColor("completed") },
	];
	let lx = 12;
	for (const item of legend) {
		ctx.fillStyle = readCSSVar("--color-text-secondary");
		ctx.fillText(item.label, lx, 20);
		ctx.fillStyle = item.color;
		ctx.fillText("●", lx, 20);
		lx += item.label.length * 7 + 12;
	}
}

/** 计算画布自动偏移，使 DAG 居中 */
export function calcAutoOffset(
	width: number,
	height: number,
	nodes: LayoutNode[],
	scale: number,
): { x: number; y: number } {
	if (nodes.length === 0) return { x: 0, y: 0 };
	const xs = nodes.map((n) => n.x);
	const ys = nodes.map((n) => n.y);
	const minX = Math.min(...xs, 0);
	const maxX = Math.max(...xs, 0);
	const minY = Math.min(...ys, 0);
	const maxY = Math.max(...ys, 0);
	const graphW = maxX - minX + 80;
	const graphH = maxY - minY + 80;
	return {
		x: (width - graphW * scale) / 2 - minX * scale,
		y: (height - graphH * scale) / 2 - minY * scale,
	};
}

/** 检测鼠标位置是否命中某个节点 */
export function hitTestNode(
	mx: number,
	my: number,
	nodes: LayoutNode[],
	radius = 28,
): number | null {
	for (const n of nodes) {
		const dx = mx - n.x;
		const dy = my - n.y;
		if (dx * dx + dy * dy < radius * radius) {
			return n.id;
		}
	}
	return null;
}
