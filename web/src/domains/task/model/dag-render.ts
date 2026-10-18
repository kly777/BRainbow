// ── 依赖图 Canvas 渲染 ──
//
// Canvas 拿不到 CSS，只能读令牌的计算值。这里一律经 `readToken(TokenName)`
// （@shared/styles/tokens.ts）：变量名写错是编译错误，不再像改造前那样
// 静默取到空串、再被 Canvas 静默忽略成默认黑。

import { readToken, type TokenName } from "@shared/styles";
import type { LayoutEdge, LayoutNode } from "./dag-layout.ts";
import { statusToken } from "./status-colors.ts";

// 画布用色：注解成 TokenName，名字错在编译期就报
/** 边与箭头 */
const EDGE: TokenName = "--t-color-border";
/** hover 节点的描边与完整标题 */
const HOVER_INK: TokenName = "--t-color-ink";
/** 节点外圈描边：节点与画布背景的分离环，随主题（浅色主题近白 / 暗色主题深色） */
const NODE_RING: TokenName = "--t-color-surface";
/** 节点内文字：正值令牌就是「实底饱和色上的文字」（浅色主题白字 / 暗色主题深墨字） */
const NODE_TEXT: TokenName = "--t-color-on-solid";
/** 图例文字 */
const LEGEND_TEXT: TokenName = "--t-color-ink-muted";
/** 节点阴影环的本体色，透明度由 globalAlpha 表达（tokens.css 禁止内联 oklch/hex） */
const SHADOW_INK: TokenName = "--t-color-ink-strong";

function statusColor(status: string): string {
	return readToken(statusToken(status));
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
		ctx.strokeStyle = readToken(EDGE);
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
		ctx.fillStyle = readToken(EDGE);
		ctx.fill();
	}

	// 节点
	for (const n of lay.nodes) {
		const r = 28;
		const isHovered = hoveredId === n.id;

		// 阴影：令牌色 + globalAlpha 表达透明度（tokens.css 硬规则禁止内联 oklch/hex）
		ctx.beginPath();
		ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
		ctx.globalAlpha = isHovered ? 0.15 : 0.08;
		ctx.fillStyle = readToken(SHADOW_INK);
		ctx.fill();
		ctx.globalAlpha = 1;

		// 圆
		ctx.beginPath();
		ctx.arc(n.x, n.y, r - 2, 0, Math.PI * 2);
		ctx.fillStyle = statusColor(n.status);
		ctx.fill();
		ctx.strokeStyle = isHovered ? readToken(HOVER_INK) : readToken(NODE_RING);
		ctx.lineWidth = 2;
		ctx.stroke();

		// 文字
		const text = n.title.length > 6 ? `${n.title.slice(0, 5)}…` : n.title;
		ctx.fillStyle = readToken(NODE_TEXT);
		ctx.font = `${isHovered ? "bold " : ""}0.625rem sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(text, n.x, n.y);

		// hover 时显示完整标题
		if (isHovered) {
			ctx.fillStyle = readToken(HOVER_INK);
			ctx.font = "0.75rem sans-serif";
			ctx.fillText(n.title, n.x, n.y - r - 12);
		}
	}

	// 图例
	ctx.restore();
	ctx.fillStyle = readToken(LEGEND_TEXT);
	ctx.font = "0.6875rem sans-serif";
	ctx.textAlign = "left";

	const legend = [
		{ label: "● 待办", color: statusColor("backlog") },
		{ label: "● 进行中", color: statusColor("active") },
		{ label: "● 已完成", color: statusColor("completed") },
	];
	let lx = 12;
	for (const item of legend) {
		ctx.fillStyle = readToken(LEGEND_TEXT);
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
