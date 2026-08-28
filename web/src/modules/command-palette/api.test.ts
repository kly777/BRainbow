import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchE } from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	request: vi.fn(),
}));

describe("command-palette API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("跨模块站内搜索", async () => {
		// 测试跨模块站内搜索
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockResponse = {
			hits: [
				{
					kind: "Task",
					id: 1,
					title: "测试任务",
					snippet: "任务描述",
					target: {
						type: "Task",
						params: { id: 1 },
					},
				},
				{
					kind: "Card",
					id: 2,
					title: "测试卡片",
					snippet: "卡片内容",
					target: {
						type: "Card",
						params: { id: 2 },
					},
				},
			],
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockResponse);

		// 调用搜索API
		const result = await searchE("测试", 4);

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith(
			"/search?q=%E6%B5%8B%E8%AF%95&limit=4",
			{},
		);

		// 验证返回结果
		expect(result).toEqual(mockResponse);
	});

	it("搜索命中项的导航目标", async () => {
		// 测试搜索命中项的导航目标
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockResponse = {
			hits: [
				{
					kind: "Bookmark",
					id: 3,
					title: "测试书签",
					snippet: "书签描述",
					target: {
						type: "Bookmark",
						params: { id: 3 },
					},
				},
			],
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockResponse);

		// 调用搜索API
		const result = await searchE("书签", 4);

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith(
			"/search?q=%E4%B9%A6%E7%AD%BE&limit=4",
			{},
		);

		// 验证返回结果
		expect(result).toEqual(mockResponse);
	});
});
