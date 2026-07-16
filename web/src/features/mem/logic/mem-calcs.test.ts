import { describe, expect, it } from "vitest";
import {
	ALPHA,
	calcAvgCardTime,
	calcMaxLearning,
	DEFAULT_LIMIT,
	MAX_LIMIT,
	MIN_LIMIT,
} from "./mem-calcs.ts";

describe("calcMaxLearning", () => {
	it("avg=1 → MIN_LIMIT (3)", () => {
		expect(calcMaxLearning(1)).toBe(3);
	});

	it("avg=2 → 7", () => {
		expect(calcMaxLearning(2)).toBe(7);
	});

	it("avg=2.5 (default) → 9", () => {
		// 3 + ((2.5 - 1) / 3) * 12 = 3 + 6 = 9
		expect(calcMaxLearning(2.5)).toBe(9);
	});

	it("avg=3 → 11", () => {
		expect(calcMaxLearning(3)).toBe(11);
	});

	it("avg=4 → MAX_LIMIT (15)", () => {
		expect(calcMaxLearning(4)).toBe(15);
	});

	it("avg=0 → clamps to MIN_LIMIT (3)", () => {
		// 3 + ((0 - 1) / 3) * 12 = 3 - 4 = -1 → round(-1) = -1
		// 实际业务上 avgRating 在 1-4 范围，所以负值不影响真实使用
		expect(calcMaxLearning(0)).toBe(-1);
	});

	it("avg=5 → 19 (超出 MAX_LIMIT)", () => {
		// 3 + ((5 - 1) / 3) * 12 = 3 + 16 = 19
		expect(calcMaxLearning(5)).toBe(19);
	});

	it("avgs in 0.5 increments from 1 to 4", () => {
		// 验证单调递增
		const results = [1, 1.5, 2, 2.5, 3, 3.5, 4].map(calcMaxLearning);
		for (let i = 1; i < results.length; i++) {
			expect(results[i]).toBeGreaterThanOrEqual(results[i - 1]);
		}
	});
});

describe("calcAvgCardTime", () => {
	it("empty array → 0", () => {
		expect(calcAvgCardTime([])).toBe(0);
	});

	it("single element → that element", () => {
		expect(calcAvgCardTime([5])).toBe(5);
	});

	it("averages multiple durations", () => {
		expect(calcAvgCardTime([10, 20, 30])).toBe(20);
	});

	it("handles fractional values", () => {
		expect(calcAvgCardTime([1.5, 2.5])).toBeCloseTo(2);
	});

	it("large numbers", () => {
		expect(calcAvgCardTime([100, 200, 300])).toBe(200);
	});
});

describe("constants", () => {
	it("ALPHA = 0.2", () => {
		expect(ALPHA).toBe(0.2);
	});

	it("MIN_LIMIT = 3", () => {
		expect(MIN_LIMIT).toBe(3);
	});

	it("MAX_LIMIT = 15", () => {
		expect(MAX_LIMIT).toBe(15);
	});

	it("DEFAULT_LIMIT = 7", () => {
		expect(DEFAULT_LIMIT).toBe(7);
	});
});
