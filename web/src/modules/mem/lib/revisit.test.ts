import { describe, expect, it } from "vitest";
import {
	againGap,
	hardGap,
	insertRevisit,
	MAX_REVISITS,
	revisitGapFor,
	shouldDropRevisit,
} from "./revisit.ts";

describe("revisitGapFor", () => {
	it("rating 1 (Again) 间隔 1~2 张", () => {
		for (const id of [1, 2, 3, 4, 5]) {
			expect(againGap(id)).toBeGreaterThanOrEqual(1);
			expect(againGap(id)).toBeLessThanOrEqual(2);
		}
	});

	it("rating 2 (Hard) 间隔 4~6 张", () => {
		for (const id of [1, 2, 3, 4, 5]) {
			expect(hardGap(id)).toBeGreaterThanOrEqual(4);
			expect(hardGap(id)).toBeLessThanOrEqual(6);
		}
	});

	it("rating >= 3 不重插", () => {
		expect(revisitGapFor(3, 1)).toBe(0);
		expect(revisitGapFor(4, 1)).toBe(0);
	});

	it("间隔由 card id 确定（可复现）", () => {
		expect(revisitGapFor(1, 7)).toBe(revisitGapFor(1, 7));
		expect(revisitGapFor(2, 7)).toBe(revisitGapFor(2, 7));
	});
});

describe("insertRevisit", () => {
	it("当前卡移动到指定间隔之后，且下一张立即变化", () => {
		const result = insertRevisit(["A", "B", "C", "D", "E"], 0, 2);
		expect(result.next).toEqual(["B", "C", "A", "D", "E"]);
		expect(result.nextIndex).toBe(0);
	});

	it("末尾时夹紧，不让索引越界", () => {
		const result = insertRevisit(["A", "B", "C"], 2, 5);
		expect(result.next).toEqual(["A", "B", "C"]);
		expect(result.nextIndex).toBe(2);
	});

	it("单张队列原样返回", () => {
		const result = insertRevisit(["A"], 0, 2);
		expect(result.next).toEqual(["A"]);
		expect(result.nextIndex).toBe(0);
	});

	it("中间位置重插不破坏其它卡顺序", () => {
		const result = insertRevisit(["A", "B", "C", "D", "E"], 1, 1);
		expect(result.next).toEqual(["A", "C", "B", "D", "E"]);
		expect(result.nextIndex).toBe(1);
	});
});

describe("shouldDropRevisit", () => {
	it(`每轮最多重插 ${MAX_REVISITS} 次`, () => {
		expect(shouldDropRevisit(0)).toBe(false);
		expect(shouldDropRevisit(1)).toBe(false);
		expect(shouldDropRevisit(2)).toBe(false);
		expect(shouldDropRevisit(3)).toBe(true);
		expect(shouldDropRevisit(10)).toBe(true);
	});
});
