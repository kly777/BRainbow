// @vitest-environment jsdom
// ── 依赖图取色的回归 ──
//
// 改造前这里整块失效而无人发现：`readCSSVar` 读的 5 个变量名（--color-border 等）
// 在本项目一个都不存在，`STATUS_COLORS` 还多写一个右括号再用 slice 手工剥壳，
// 于是每次取色都是空串 —— 而 Canvas 对非法颜色**静默忽略**（保持上一个值），
// 构建、lint、测试全都不报，图形退化成默认黑。
//
// 这组断言钉的正是"取到的必须是真令牌色，不是空串"：值经 readToken 从
// documentElement 的自定义属性读出（jsdom 支持内联自定义属性），
// 名字的正确性由 tokens-contract.test.ts 保证，两者合起来覆盖原先的失效面。

import { readToken } from "@shared/styles";
import { beforeEach, describe, expect, it } from "vitest";
import type { LayoutEdge, LayoutNode } from "./dag-layout.ts";
import { drawGraph } from "./dag-render.ts";

/** 令牌的计算值（jsdom 不会解析样式表，这里按 tokens.css 的 paper 主题赋值） */
const TOKEN_VALUES: Record<string, string> = {
	"--t-color-border": "oklch(88.5% 0.006 80deg)",
	"--t-color-ink": "oklch(24% 0.008 80deg)",
	"--t-color-ink-muted": "oklch(45% 0.008 80deg)",
	"--t-color-ink-faint": "oklch(60% 0.006 80deg)",
	"--t-color-ink-strong": "oklch(16% 0.012 80deg)",
	"--t-color-surface": "oklch(99.5% 0.002 80deg)",
	"--t-color-on-solid": "oklch(100% 0 0deg)",
	"--t-color-accent": "oklch(50% 0.08 165deg)",
	"--t-color-success": "oklch(55% 0.13 160deg)",
};

/** 记录每次 fillStyle / strokeStyle / globalAlpha 赋值的假 ctx */
function recorder() {
	const fills: string[] = [];
	const strokes: string[] = [];
	const alphas: number[] = [];
	let fill = "";
	let stroke = "";
	const noop = () => {};
	const ctx = {
		canvas: { width: 800, height: 400 },
		get fillStyle() {
			return fill;
		},
		set fillStyle(v: string) {
			fill = v;
			fills.push(v);
		},
		get strokeStyle() {
			return stroke;
		},
		set strokeStyle(v: string) {
			stroke = v;
			strokes.push(v);
		},
		set globalAlpha(v: number) {
			alphas.push(v);
		},
		clearRect: noop,
		save: noop,
		restore: noop,
		translate: noop,
		scale: noop,
		beginPath: noop,
		moveTo: noop,
		lineTo: noop,
		closePath: noop,
		stroke: noop,
		fill: noop,
		arc: noop,
		fillText: noop,
	} as unknown as CanvasRenderingContext2D;
	return { ctx, fills, strokes, alphas };
}

const nodes: LayoutNode[] = [
	{ id: 1, title: "待办任务", status: "backlog", x: 100, y: 100 },
	{ id: 2, title: "进行中任务", status: "active", x: 200, y: 100 },
	{ id: 3, title: "已完成任务", status: "completed", x: 300, y: 100 },
	{ id: 4, title: "未知状态", status: "mystery", x: 400, y: 100 },
];
const edges: LayoutEdge[] = [
	{ from: 1, to: 2, x1: 100, y1: 100, x2: 200, y2: 100 },
];

beforeEach(() => {
	for (const [name, value] of Object.entries(TOKEN_VALUES)) {
		document.documentElement.style.setProperty(name, value);
	}
});

describe("依赖图取色", () => {
	it("readToken 能取到令牌的计算值（前置条件）", () => {
		expect(readToken("--t-color-accent")).toBe(
			TOKEN_VALUES["--t-color-accent"],
		);
	});

	it("任何一次取色都不是空串——改造前全部取到空串、被 Canvas 静默忽略", () => {
		const { ctx, fills, strokes } = recorder();
		drawGraph(ctx, { nodes, edges }, 1, 0, 0, null);

		expect(fills.length).toBeGreaterThan(0);
		expect(strokes.length).toBeGreaterThan(0);
		for (const v of [...fills, ...strokes]) {
			expect(v).toBeTruthy();
			expect(v).not.toBe("undefined");
		}
	});

	it("边与箭头用 border 令牌", () => {
		const { ctx, fills, strokes } = recorder();
		drawGraph(ctx, { nodes, edges }, 1, 0, 0, null);
		expect(strokes[0]).toBe(TOKEN_VALUES["--t-color-border"]);
		expect(fills[0]).toBe(TOKEN_VALUES["--t-color-border"]);
	});

	it("节点按状态取色，四个状态各不相同（改造前 backlog/archived 两处取值互换）", () => {
		const { ctx, fills } = recorder();
		drawGraph(ctx, { nodes, edges }, 1, 0, 0, null);

		const expected = [
			TOKEN_VALUES["--t-color-ink-muted"], // backlog
			TOKEN_VALUES["--t-color-accent"], // active
			TOKEN_VALUES["--t-color-success"], // completed
			TOKEN_VALUES["--t-color-ink-muted"], // 未知状态回退 muted
		];
		for (const color of expected) {
			expect(fills).toContain(color);
		}
		expect(new Set(expected).size).toBe(3);
	});

	it("节点内文字用 on-solid（实底饱和色上的文字），不随主题失配", () => {
		const { ctx, fills } = recorder();
		drawGraph(ctx, { nodes, edges }, 1, 0, 0, null);
		expect(fills).toContain(TOKEN_VALUES["--t-color-on-solid"]);
	});

	it("阴影环用令牌色 + globalAlpha 表达透明度，不留内联 oklch", () => {
		const { ctx, fills, alphas } = recorder();
		drawGraph(ctx, { nodes, edges }, 1, 0, 0, null);

		expect(fills).toContain(TOKEN_VALUES["--t-color-ink-strong"]);
		// 每个节点一次（非 hover 0.08），且画完复原为 1
		expect(alphas.filter((a) => a === 0.08).length).toBe(nodes.length);
		expect(alphas.at(-1)).toBe(1);
		// 不再是改造前那两条内联 oklch（tokens.css 硬规则禁止组件内联 oklch/hex）
		expect(fills).not.toContain("oklch(0 0 0 / 0.15)");
		expect(fills).not.toContain("oklch(0 0 0 / 0.08)");
	});

	it("hover 的节点描边改用 ink，未 hover 用 surface", () => {
		const { ctx, strokes } = recorder();
		drawGraph(ctx, { nodes, edges }, 1, 0, 0, 2);
		expect(strokes).toContain(TOKEN_VALUES["--t-color-ink"]);
		expect(strokes).toContain(TOKEN_VALUES["--t-color-surface"]);
	});
});
