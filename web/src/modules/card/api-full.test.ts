import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createCardE,
	deleteCardE,
	getCardE,
	getCardsE,
	searchCardsE,
	updateCardE,
} from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	request: vi.fn(),
	post: vi.fn(),
	del: vi.fn(),
	buildQuery: vi.fn((params) => {
		const query = new URLSearchParams();
		Object.entries(params).forEach(([key, value]) => {
			if (value !== undefined) query.set(key, String(value));
		});
		return query.toString() ? `?${query.toString()}` : "";
	}),
	cachedRequest: vi.fn(),
	domains: {
		cards: {
			invalidate: vi.fn((promise) => promise),
		},
	},
}));

describe("card API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("获取卡片列表", async () => {
		// 测试获取卡片列表
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockCards = {
			items: [
				{
					id: 1,
					content: "测试卡片",
					created_at: "2024-01-01",
					updated_at: "2024-01-01",
				},
			],
			total: 1,
			page: 1,
			page_size: 20,
			total_pages: 1,
		};

		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockCards);

		// 调用获取卡片列表API
		const result = await getCardsE(1, 20);

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith(
			"/cards?page=1&page_size=20",
		);

		// 验证返回结果
		expect(result).toEqual(mockCards);
	});

	it("获取单张卡片", async () => {
		// 测试获取单张卡片
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockCard = {
			id: 1,
			content: "测试卡片",
			created_at: "2024-01-01",
			updated_at: "2024-01-01",
		};

		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockCard);

		// 调用获取单张卡片API
		const result = await getCardE(1);

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith("/cards/1");

		// 验证返回结果
		expect(result).toEqual(mockCard);
	});

	it("创建卡片", async () => {
		// 测试创建卡片
		const { post, domains } = await import("@shared/api");
		const mockPost = vi.mocked(post);
		const mockDomains = vi.mocked(domains);

		const mockCard = {
			id: 2,
			content: "新卡片",
			created_at: "2024-01-02",
			updated_at: "2024-01-02",
		};

		// 模拟post返回成功结果
		mockPost.mockResolvedValueOnce(mockCard);
		mockDomains.cards.invalidate.mockImplementationOnce((promise) => promise);

		// 调用创建卡片API
		const result = await createCardE({ content: "新卡片" });

		// 验证post被调用
		expect(mockPost).toHaveBeenCalledTimes(1);
		expect(mockPost).toHaveBeenCalledWith("/cards", { content: "新卡片" });

		// 验证返回结果
		expect(result).toEqual(mockCard);
	});

	it("更新卡片", async () => {
		// 测试更新卡片
		const { request, domains } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		const mockDomains = vi.mocked(domains);

		const mockCard = {
			id: 1,
			content: "更新后的卡片",
			created_at: "2024-01-01",
			updated_at: "2024-01-02",
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockCard);
		mockDomains.cards.invalidate.mockImplementationOnce((promise) => promise);

		// 调用更新卡片API
		const result = await updateCardE(1, { content: "更新后的卡片" });

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/cards/1", {
			method: "PATCH",
			body: JSON.stringify({ content: "更新后的卡片" }),
		});

		// 验证返回结果
		expect(result).toEqual(mockCard);
	});

	it("删除卡片", async () => {
		// 测试删除卡片
		const { del, domains } = await import("@shared/api");
		const mockDel = vi.mocked(del);
		const mockDomains = vi.mocked(domains);

		const mockResult = { ok: true };

		// 模拟del返回成功结果
		mockDel.mockResolvedValueOnce(mockResult);
		mockDomains.cards.invalidate.mockImplementationOnce((promise) => promise);

		// 调用删除卡片API
		const result = await deleteCardE(1);

		// 验证del被调用
		expect(mockDel).toHaveBeenCalledTimes(1);
		expect(mockDel).toHaveBeenCalledWith("/cards/1");

		// 验证返回结果
		expect(result).toEqual(mockResult);
	});

	it("搜索卡片", async () => {
		// 测试搜索卡片
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockResponse = {
			items: [
				{
					id: 1,
					content: "测试卡片",
					created_at: "2024-01-01",
					updated_at: "2024-01-01",
				},
			],
			total: 1,
			page: 1,
			page_size: 20,
			total_pages: 1,
		};

		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockResponse);

		// 调用搜索卡片API
		const result = await searchCardsE("测试", 1, 20);

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith(
			"/cards/search?q=%E6%B5%8B%E8%AF%95&page=1&page_size=20",
		);

		// 验证返回结果
		expect(result).toEqual(mockResponse);
	});
});
