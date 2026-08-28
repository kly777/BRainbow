import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createBookmarkE,
	deleteBookmarkE,
	deleteBookmarkTagE,
	getBookmarkE,
	getBookmarksE,
	importBookmarksE,
	searchBookmarksE,
	searchBookmarkTagsE,
	setBookmarkTagsE,
	updateBookmarkE,
} from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	request: vi.fn(),
	post: vi.fn(),
	patch: vi.fn(),
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
		bookmarks: {
			invalidate: vi.fn((promise: any) => promise),
		},
	},
}));

describe("bookmark API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("获取书签列表", async () => {
		// 测试获取书签列表
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockBookmarks = {
			items: [
				{
					id: 1,
					title: "测试书签",
					url: "https://example.com",
					description: "测试描述",
					tags: ["测试"],
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
		mockCachedRequest.mockResolvedValueOnce(mockBookmarks);

		// 调用获取书签列表API
		const result = await getBookmarksE(1, 20, "测试");

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith(
			"/bookmarks?page=1&page_size=20&tag=%E6%B5%8B%E8%AF%95",
		);

		// 验证返回结果
		expect(result).toEqual(mockBookmarks);
	});

	it("获取单个书签", async () => {
		// 测试获取单个书签
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockBookmark = {
			id: 1,
			title: "测试书签",
			url: "https://example.com",
			description: "测试描述",
			tags: ["测试"],
			created_at: "2024-01-01",
			updated_at: "2024-01-01",
		};

		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockBookmark);

		// 调用获取单个书签API
		const result = await getBookmarkE(1);

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith("/bookmarks/1");

		// 验证返回结果
		expect(result).toEqual(mockBookmark);
	});

	it("创建书签", async () => {
		// 测试创建书签
		const { post, domains } = await import("@shared/api");
		const mockPost = vi.mocked(post);
		const mockDomains = vi.mocked(domains);

		const mockBookmark = {
			id: 2,
			title: "新书签",
			url: "https://example.com",
			description: "新描述",
			tags: ["新标签"],
			created_at: "2024-01-02",
			updated_at: "2024-01-02",
		};

		// 模拟post返回成功结果
		mockPost.mockResolvedValueOnce(mockBookmark);
		// @ts-expect-error - mock type mismatch
		mockDomains.bookmarks.invalidate.mockImplementationOnce(
			(promise: any) => promise,
		);

		// 调用创建书签API
		const result = await createBookmarkE({
			title: "新书签",
			url: "https://example.com",
			description: "新描述",
			tags: ["新标签"],
		});

		// 验证post被调用
		expect(mockPost).toHaveBeenCalledTimes(1);
		expect(mockPost).toHaveBeenCalledWith("/bookmarks", {
			title: "新书签",
			url: "https://example.com",
			description: "新描述",
			tags: ["新标签"],
		});

		// 验证返回结果
		expect(result).toEqual(mockBookmark);
	});

	it("更新书签", async () => {
		// 测试更新书签
		const { patch, domains } = await import("@shared/api");
		const mockPatch = vi.mocked(patch);
		const mockDomains = vi.mocked(domains);

		const mockBookmark = {
			id: 1,
			title: "更新后的书签",
			url: "https://example.com",
			description: "更新后的描述",
			tags: ["测试"],
			created_at: "2024-01-01",
			updated_at: "2024-01-02",
		};

		// 模拟patch返回成功结果
		mockPatch.mockResolvedValueOnce(mockBookmark);
		// @ts-expect-error - mock type mismatch
		mockDomains.bookmarks.invalidate.mockImplementationOnce(
			(promise: any) => promise,
		);

		// 调用更新书签API
		const result = await updateBookmarkE(1, { title: "更新后的书签" });

		// 验证patch被调用
		expect(mockPatch).toHaveBeenCalledTimes(1);
		expect(mockPatch).toHaveBeenCalledWith("/bookmarks/1", {
			title: "更新后的书签",
		});

		// 验证返回结果
		expect(result).toEqual(mockBookmark);
	});

	it("删除书签", async () => {
		// 测试删除书签
		const { del, domains } = await import("@shared/api");
		const mockDel = vi.mocked(del);
		const mockDomains = vi.mocked(domains);

		const mockResult = { ok: true };

		// 模拟del返回成功结果
		mockDel.mockResolvedValueOnce(mockResult);
		// @ts-expect-error - mock type mismatch
		mockDomains.bookmarks.invalidate.mockImplementationOnce(
			(promise: any) => promise,
		);

		// 调用删除书签API
		const result = await deleteBookmarkE(1);

		// 验证del被调用
		expect(mockDel).toHaveBeenCalledTimes(1);
		expect(mockDel).toHaveBeenCalledWith("/bookmarks/1");

		// 验证返回结果
		expect(result).toEqual(mockResult);
	});

	it("搜索书签", async () => {
		// 测试搜索书签
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockResponse = {
			items: [
				{
					id: 1,
					title: "测试书签",
					url: "https://example.com",
					description: "测试描述",
					tags: ["测试"],
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

		// 调用搜索书签API
		const result = await searchBookmarksE("测试", 1, 20, "标签");

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith(
			"/bookmarks/search?q=%E6%B5%8B%E8%AF%95&page=1&page_size=20&tag=%E6%A0%87%E7%AD%BE",
		);

		// 验证返回结果
		expect(result).toEqual(mockResponse);
	});

	it("管理标签", async () => {
		// 测试管理标签
		const { cachedRequest, request, del, domains } = await import(
			"@shared/api"
		);
		const mockCachedRequest = vi.mocked(cachedRequest);
		const mockRequest = vi.mocked(request);
		const mockDel = vi.mocked(del);
		const mockDomains = vi.mocked(domains);

		const mockTags = [
			{ id: 1, name: "测试", count: 5 },
			{ id: 2, name: "标签", count: 3 },
		];

		const mockTagResult = [
			{ id: 1, name: "测试" },
			{ id: 2, name: "标签" },
		];

		const mockDeleteResult = { ok: true };

		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockTags);
		mockRequest.mockResolvedValueOnce(mockTagResult);
		mockDel.mockResolvedValueOnce(mockDeleteResult);
		// @ts-expect-error - mock type mismatch
		mockDomains.bookmarks.invalidate.mockImplementation((promise: any) => promise);

		// 调用搜索标签API
		const tagsResult = await searchBookmarkTagsE("测试");

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith(
			"/bookmarks/tags?q=%E6%B5%8B%E8%AF%95",
		);

		// 验证返回结果
		expect(tagsResult).toEqual(mockTags);

		// 调用设置标签API
		const setResult = await setBookmarkTagsE(1, ["测试", "标签"]);

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/bookmarks/1/tags", {
			method: "PUT",
			body: JSON.stringify({ tags: ["测试", "标签"] }),
		});

		// 验证返回结果
		expect(setResult).toEqual(mockTagResult);

		// 调用删除标签API
		const deleteResult = await deleteBookmarkTagE(1);

		// 验证del被调用
		expect(mockDel).toHaveBeenCalledTimes(1);
		expect(mockDel).toHaveBeenCalledWith("/bookmarks/tags/1");

		// 验证返回结果
		expect(deleteResult).toEqual(mockDeleteResult);
	});

	it("导入书签", async () => {
		// 测试导入书签
		const { request, domains } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		const mockDomains = vi.mocked(domains);

		const mockResult = {
			total: 10,
			created: 5,
			merged: 2,
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockResult);
		// @ts-expect-error - mock type mismatch
		mockDomains.bookmarks.invalidate.mockImplementationOnce(
			(promise: any) => promise,
		);

		// 创建模拟文件
		const mockFile = new File(["<html>"], "bookmarks.html", {
			type: "text/html",
		});

		// 调用导入书签API
		const result = await importBookmarksE(mockFile);

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/bookmarks/import", {
			method: "POST",
			body: expect.any(FormData),
			timeout: false,
		});

		// 验证返回结果
		expect(result).toEqual(mockResult);
	});
});