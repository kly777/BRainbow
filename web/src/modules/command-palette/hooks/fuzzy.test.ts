import { beforeEach, describe, expect, it, vi } from "vitest";
import { fuzzyMatch, fuzzyScore } from "./fuzzy.ts";
import { generateSuggestions } from "./suggestions.ts";

describe("command-palette hooks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("模糊搜索功能", async () => {
		// 测试模糊搜索功能
		const query = "测试";
		const text = "这是一个测试文本";

		const result = fuzzyMatch(query, text);

		// 验证返回结果
		expect(result).toBeDefined();
		expect(typeof result).toBe("boolean");
	});

	it("模糊评分功能", async () => {
		// 测试模糊评分功能
		const query = "测试";
		const text = "这是一个测试文本";

		const result = fuzzyScore(query, text);

		// 验证返回结果
		expect(result).toBeDefined();
		expect(typeof result).toBe("number");
	});

	it("建议生成功能", async () => {
		// 测试建议生成功能
		const query = "测试";
		const items = [
			{ id: 1, title: "测试任务", kind: "task" },
			{ id: 2, title: "测试卡片", kind: "card" },
			{ id: 3, title: "其他内容", kind: "other" },
		];

		const result = generateSuggestions(query, items);

		// 验证返回结果
		expect(result).toBeDefined();
		expect(Array.isArray(result)).toBe(true);
		expect(result.length).toBeLessThanOrEqual(items.length);
	});
});
