import { describe, expect, it, vi, beforeEach } from "vitest";
import { fuzzyMatch, fuzzyFilter } from "./fuzzy.ts";

describe("fuzzy 模块", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fuzzyMatch 模糊匹配函数", async () => {
		// 测试fuzzyMatch函数
		const query = "测试";
		const text = "这是一个测试文本";

		const result = fuzzyMatch(query, text);

		// 验证返回结果
		expect(result).toBeDefined();
		expect(result.matched).toBeDefined();
		expect(result.score).toBeDefined();
		expect(typeof result.matched).toBe("boolean");
		expect(typeof result.score).toBe("number");
	});

	it("fuzzyMatch 精确匹配", async () => {
		// 测试精确匹配
		const query = "测试";
		const text = "测试";

		const result = fuzzyMatch(query, text);

		// 验证返回结果
		expect(result.matched).toBe(true);
		expect(result.score).toBeLessThan(0);
	});

	it("fuzzyMatch 不匹配", async () => {
		// 测试不匹配
		const query = "xyz";
		const text = "abc";

		const result = fuzzyMatch(query, text);

		// 验证返回结果
		expect(result.matched).toBe(false);
		expect(result.score).toBe(Number.POSITIVE_INFINITY);
	});

	it("fuzzyFilter 模糊过滤函数", async () => {
		// 测试fuzzyFilter函数
		const query = "测试";
		const items = [
			{ id: 1, title: "测试任务" },
			{ id: 2, title: "测试卡片" },
			{ id: 3, title: "完全不同的内容" },
		];

		const result = fuzzyFilter(items, query, (item) => [item.title]);

		// 验证返回结果
		expect(result).toBeDefined();
		expect(Array.isArray(result)).toBe(true);
		expect(result.length).toBeLessThanOrEqual(items.length);
	});

	it("fuzzyFilter 空查询返回所有项", async () => {
		// 测试空查询返回所有项
		const query = "";
		const items = [
			{ id: 1, title: "测试任务" },
			{ id: 2, title: "测试卡片" },
			{ id: 3, title: "完全不同的内容" },
		];

		const result = fuzzyFilter(items, query, (item) => [item.title]);

		// 验证返回结果
		expect(result).toBeDefined();
		expect(Array.isArray(result)).toBe(true);
		expect(result.length).toBe(items.length);
	});
});
