import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadTextE, saveTextE } from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	cachedRequest: vi.fn(),
	put: vi.fn(),
	domains: {
		text: {
			invalidate: vi.fn((promise) => promise),
		},
	},
}));

describe("text API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("加载文本数据", async () => {
		// 测试加载文本数据
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);
		
		const mockTextResponse = {
			tabs: [
				{
					id: 1,
					name: "笔记1",
					content: "笔记内容1",
				},
				{
					id: 2,
					name: "笔记2",
					content: "笔记内容2",
				},
			],
		};
		
		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockTextResponse);

		// 调用加载文本数据API
		const result = await loadTextE();
		
		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith("/text");
		
		// 验证返回结果
		expect(result).toEqual(mockTextResponse);
	});

	it("保存文本数据", async () => {
		// 测试保存文本数据
		const { put, domains } = await import("@shared/api");
		const mockPut = vi.mocked(put);
		const mockDomains = vi.mocked(domains);
		
		const mockResult = { ok: true };
		
		// 模拟put返回成功结果
		mockPut.mockResolvedValueOnce(mockResult);
		mockDomains.text.invalidate.mockImplementationOnce((promise) => promise);

		// 调用保存文本数据API
		const result = await saveTextE([
			{ name: "笔记1", content: "笔记内容1" },
			{ name: "笔记2", content: "笔记内容2" },
		]);
		
		// 验证put被调用
		expect(mockPut).toHaveBeenCalledTimes(1);
		expect(mockPut).toHaveBeenCalledWith("/text", {
			tabs: [
				{ name: "笔记1", content: "笔记内容1" },
				{ name: "笔记2", content: "笔记内容2" },
			],
		});
		
		// 验证返回结果
		expect(result).toEqual(mockResult);
	});
});