import { beforeEach, describe, expect, it, vi } from "vitest";
import { fuzzyFilter, fuzzyMatch } from "./fuzzy.ts";
import { buildCmdItems, buildNavItems } from "./suggestions.ts";

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

	it("模糊过滤功能", async () => {
		// 测试模糊过滤功能
		const query = "测试";
		const items = [
			{ title: "测试任务", path: "/task" },
			{ title: "测试卡片", path: "/card" },
			{ title: "其他内容", path: "/other" },
		];

		const result = fuzzyFilter(items, query, (item) => [item.title]);

		// 验证返回结果
		expect(result).toBeDefined();
		expect(Array.isArray(result)).toBe(true);
	});

	it("导航项构建功能", async () => {
		// 测试导航项构建功能
		const mockNavigate = vi.fn();
		const mockClose = vi.fn();
		const query = "任务";

		const result = buildNavItems(query, mockNavigate, mockClose);

		// 验证返回结果
		expect(result).toBeDefined();
		expect(Array.isArray(result)).toBe(true);
	});
});
