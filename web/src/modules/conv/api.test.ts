import { describe, expect, it, vi, beforeEach } from "vitest";
import { searchConvE, getConvDetailE, getConvConceptE } from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	request: vi.fn(),
}));

describe("conv API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("搜索对话", async () => {
		// 测试搜索对话
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		
		const mockResponse = {
			hits: [
				{
					conv_id: 1,
					title: "测试对话",
					conv_type: "article",
					snippet: "对话内容",
					match_field: "title",
					created_at: "2024-01-01",
					score: 0.95,
				},
			],
			total: 1,
		};
		
		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockResponse);

		// 调用搜索对话API
		const result = await searchConvE("测试", "all", 50);
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/conv/search?q=%E6%B5%8B%E8%AF%95&limit=50&search_type=all");
		
		// 验证返回结果
		expect(result).toEqual(mockResponse);
	});

	it("获取对话详情", async () => {
		// 测试获取对话详情
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		
		const mockDetail = {
			conv_id: 1,
			title: "测试对话",
			conv_type: "article",
			created_at: "2024-01-01",
			articles: [
				{
					article_type: "article",
					title: "文章标题",
					content: "文章内容",
				},
			],
		};
		
		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockDetail);

		// 调用获取对话详情API
		const result = await getConvDetailE(1);
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/conv/1");
		
		// 验证返回结果
		expect(result).toEqual(mockDetail);
	});

	it("获取对话概念", async () => {
		// 测试获取对话概念
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		
		const mockConcept = {
			conv_id: 1,
			article_type: "article",
			title: "概念标题",
			content: "概念内容",
		};
		
		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockConcept);

		// 调用获取对话概念API
		const result = await getConvConceptE(1, "article");
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/conv/concept/1?article=article");
		
		// 验证返回结果
		expect(result).toEqual(mockConcept);
	});
});