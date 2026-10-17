// @vitest-environment jsdom
// 时间轴的像素映射与重叠布局（对着 06-日历视图 §4 的验收表）。

import { describe, expect, it } from "vitest";
import {
	type AxisBlock,
	blockHeight,
	blockSize,
	dragOffsetToMinute,
	type HourMark,
	hourMarks,
	layoutOverlaps,
	MIN_BLOCK_HEIGHT,
	minutesToPixels,
	nowLineTop,
	pixelsToMinutes,
	projectToDay,
	SNAP_MINUTES,
	snapToGrid,
} from "./calendarAxis.ts";

function block(id: number, startMinute: number, endMinute: number): AxisBlock {
	const iso = (m: number) =>
		new Date(2026, 9, 3, Math.floor(m / 60), m % 60).toISOString();
	return {
		id,
		startMinute,
		endMinute,
		startIso: iso(startMinute),
		endIso: iso(endMinute),
		title: `块 ${id}`,
		taskId: id,
		windowType: "planned",
		status: "active",
		priority: null,
	};
}

describe("像素 ↔ 时刻", () => {
	it("两者互逆", () => {
		for (const minute of [0, 15, 90, 600, 1439]) {
			expect(pixelsToMinutes(minutesToPixels(minute))).toBeCloseTo(minute, 6);
		}
	});

	it("夹在一天之内（拖到轴外也不产生负数或跨天）", () => {
		expect(pixelsToMinutes(-500)).toBe(0);
		expect(pixelsToMinutes(999_999)).toBe(24 * 60);
	});

	it("吸附到 15 分钟网格", () => {
		expect(SNAP_MINUTES).toBe(15);
		expect(snapToGrid(7)).toBe(0);
		expect(snapToGrid(8)).toBe(15);
		expect(snapToGrid(22)).toBe(15);
		expect(snapToGrid(23)).toBe(30);
		// 负数也往 0 方向吸，不产生 -15
		expect(snapToGrid(-1)).toBe(0);
	});
});

describe("块高度与分档（S5-b）", () => {
	it("高度 ∝ 时长", () => {
		const oneHour = blockHeight(block(1, 0, 60));
		const twoHours = blockHeight(block(2, 0, 120));
		expect(twoHours).toBeCloseTo(oneHour * 2, 6);
	});

	it("S5-b：最短 24px（WCAG 2.5.8），5 分钟的块也要够摸到", () => {
		expect(blockHeight(block(1, 0, 5))).toBe(MIN_BLOCK_HEIGHT);
		expect(blockHeight(block(2, 0, 0))).toBe(MIN_BLOCK_HEIGHT);
	});

	it("分档：极短 / 短 / 中 / 长", () => {
		expect(blockSize(15)).toBe("tiny");
		expect(blockSize(45)).toBe("short");
		expect(blockSize(90)).toBe("medium");
		expect(blockSize(240)).toBe("long");
	});
});

describe("贪心区间图着色（S5-c）", () => {
	it("不重叠的块各自占一列（列数 = 最大同时重叠数）", () => {
		const laid = layoutOverlaps([
			block(1, 0, 60),
			block(2, 60, 120),
			block(3, 120, 180),
		]);
		expect(laid.map((b) => b.column)).toEqual([0, 0, 0]);
		expect(laid[0].columns).toBe(1);
	});

	it("S5-c：3 个事件重叠 → 并排，列数 == 最大同时重叠数", () => {
		const laid = layoutOverlaps([
			block(1, 0, 120),
			block(2, 30, 150),
			block(3, 60, 180),
		]);
		expect(laid).toHaveLength(3);
		expect(laid.map((b) => b.column).sort()).toEqual([0, 1, 2]);
		expect(laid.every((b) => b.columns === 3)).toBe(true);
	});

	it("半开区间：边界相接不算重叠（与 C002 同一约定）", () => {
		// 09:00–10:00 与 10:00–11:00 共用第 0 列
		const laid = layoutOverlaps([block(1, 540, 600), block(2, 600, 660)]);
		expect(laid.map((b) => b.column)).toEqual([0, 0]);
		expect(laid[0].columns).toBe(1);
	});

	it("复用最早空出的列（贪心：第一个 `end <= start` 的列）", () => {
		//        0    1    2    3    4    5
		// A  ┌───────────────────────┐      列 0（0–300）
		// B  │    ┌──────────┐        │      列 1（60–180）
		// C  │    │          │  ┌───┐ │      列 1（180 已空出，C 复用它）
		const laid = layoutOverlaps([
			block(1, 0, 300),
			block(2, 60, 180),
			block(3, 200, 260),
		]);
		const byId = new Map(laid.map((b) => [b.id, b]));
		expect(byId.get(1)?.column).toBe(0);
		expect(byId.get(2)?.column).toBe(1);
		// C 的起点 200 时，列 0 还被 A 占着（到 300），列 1 已空出（180 <= 200）→ 复用列 1
		expect(byId.get(3)?.column).toBe(1);
		expect(byId.get(3)?.columns).toBe(2);
	});

	it("输入数组不被就地排序（调用方的顺序不能变）", () => {
		const input = [block(2, 100, 120), block(1, 0, 60)];
		const copy = [...input];
		layoutOverlaps(input);
		expect(input).toEqual(copy);
	});

	it("同起点时短块先选列（长的占更多列，先给它挑）", () => {
		const laid = layoutOverlaps([block(1, 0, 300), block(2, 0, 60)]);
		expect(laid.map((b) => b.id)).toEqual([2, 1]); // 输出按排好序的顺序
		expect(laid[0].column).toBe(0); // 短块拿到列 0
		expect(laid[1].column).toBe(1);
	});

	it("空输入不炸", () => {
		expect(layoutOverlaps([])).toEqual([]);
	});
});

describe("刻度与当前时间线（S5-a）", () => {
	it("24 个整点刻度，位置单调", () => {
		const marks: HourMark[] = hourMarks();
		expect(marks).toHaveLength(24);
		expect(marks[0].label).toBe("00:00");
		expect(marks[23].top).toBeGreaterThan(marks[0].top);
		for (let i = 1; i < marks.length; i++) {
			expect(marks[i].top).toBeGreaterThan(marks[i - 1].top);
		}
	});

	it("nowLineTop：当前时刻在轴上的位置", () => {
		expect(nowLineTop(new Date(2026, 9, 3, 9, 0))).toBeCloseTo(
			minutesToPixels(540),
			6,
		);
	});
});

describe("拖拽落点与跨天投影", () => {
	it("Y 偏移 → 已吸附的分钟", () => {
		expect(dragOffsetToMinute(0)).toBe(0);
		// 一小时 = 48px，10px ≈ 12.5 分钟 → 吸到 15
		expect(dragOffsetToMinute(10)).toBe(15);
		expect(dragOffsetToMinute(minutesToPixels(90))).toBe(90);
	});

	it("跨天事件在某一天的投影被裁到当天边界", () => {
		// 22:00 → 次日 02:00 的事件
		const spanning = { startMinute: 22 * 60, endMinute: 26 * 60 };
		// 当天（第一段）
		expect(projectToDay(spanning, 0)).toEqual({
			startMinute: 22 * 60,
			endMinute: 24 * 60,
		});
		// 次日（第二段）
		expect(projectToDay(spanning, 1)).toEqual({
			startMinute: 0,
			endMinute: 2 * 60,
		});
	});
});
