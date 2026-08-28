import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	deleteMediaE,
	getMediaE,
	listMediaE,
	renameMediaE,
	uploadMedia,
} from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	request: vi.fn(),
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
		media: {
			invalidate: vi.fn((promise) => promise),
		},
	},
}));

describe("media API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("上传媒体文件", async () => {
		// 测试上传媒体文件
		const { request, domains } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		const mockDomains = vi.mocked(domains);

		const mockMediaItem = {
			stored_id: "abc123",
			url: "/uploads/test.jpg",
			original_name: "test.jpg",
			media_type: "image",
			mime_type: "image/jpeg",
			size_bytes: 1024,
			width: 800,
			height: 600,
			duration_ms: null,
			created_at: "2024-01-01",
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockMediaItem);
		// @ts-expect-error - mock type mismatch
		mockDomains.media.invalidate.mockImplementationOnce((promise) => promise);

		// 创建模拟文件
		const mockFile = new File(["test"], "test.jpg", { type: "image/jpeg" });

		// 调用上传媒体文件API
		const result = await uploadMedia(mockFile);

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/media/upload", {
			method: "POST",
			body: expect.any(FormData),
			timeout: false,
		});

		// 验证返回结果
		expect(result).toEqual(mockMediaItem);
	});

	it("获取媒体列表", async () => {
		// 测试获取媒体列表
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockMediaList = {
			items: [
				{
					stored_id: "abc123",
					url: "/uploads/test.jpg",
					original_name: "test.jpg",
					media_type: "image",
					mime_type: "image/jpeg",
					size_bytes: 1024,
					width: 800,
					height: 600,
					duration_ms: null,
					created_at: "2024-01-01",
				},
			],
			total: 1,
			page: 1,
			page_size: 20,
			total_pages: 1,
		};

		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockMediaList);

		// 调用获取媒体列表API
		const result = await listMediaE({
			media_type: "image",
			page: 1,
			page_size: 20,
		});

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith(
			"/media?media_type=image&page=1&page_size=20",
		);

		// 验证返回结果
		expect(result).toEqual(mockMediaList);
	});

	it("获取媒体详情", async () => {
		// 测试获取媒体详情
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockMediaItem = {
			stored_id: "abc123",
			url: "/uploads/test.jpg",
			original_name: "test.jpg",
			media_type: "image",
			mime_type: "image/jpeg",
			size_bytes: 1024,
			width: 800,
			height: 600,
			duration_ms: null,
			created_at: "2024-01-01",
		};

		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockMediaItem);

		// 调用获取媒体详情API
		const result = await getMediaE("abc123");

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith("/media/abc123");

		// 验证返回结果
		expect(result).toEqual(mockMediaItem);
	});

	it("重命名媒体", async () => {
		// 测试重命名媒体
		const { patch, domains } = await import("@shared/api");
		const mockPatch = vi.mocked(patch);
		const mockDomains = vi.mocked(domains);

		const mockMediaItem = {
			stored_id: "abc123",
			url: "/uploads/test.jpg",
			original_name: "新名称.jpg",
			media_type: "image",
			mime_type: "image/jpeg",
			size_bytes: 1024,
			width: 800,
			height: 600,
			duration_ms: null,
			created_at: "2024-01-01",
		};

		// 模拟patch返回成功结果
		mockPatch.mockResolvedValueOnce(mockMediaItem);
		// @ts-expect-error - mock type mismatch
		mockDomains.media.invalidate.mockImplementationOnce((promise) => promise);

		// 调用重命名媒体API
		const result = await renameMediaE("abc123", "新名称.jpg");

		// 验证patch被调用
		expect(mockPatch).toHaveBeenCalledTimes(1);
		expect(mockPatch).toHaveBeenCalledWith("/media/abc123", {
			original_name: "新名称.jpg",
		});

		// 验证返回结果
		expect(result).toEqual(mockMediaItem);
	});

	it("删除媒体", async () => {
		// 测试删除媒体
		const { del, domains } = await import("@shared/api");
		const mockDel = vi.mocked(del);
		const mockDomains = vi.mocked(domains);

		const mockResult = { ok: true };

		// 模拟del返回成功结果
		mockDel.mockResolvedValueOnce(mockResult);
		// @ts-expect-error - mock type mismatch
		mockDomains.media.invalidate.mockImplementationOnce((promise) => promise);

		// 调用删除媒体API
		const result = await deleteMediaE("abc123", true);

		// 验证del被调用
		expect(mockDel).toHaveBeenCalledTimes(1);
		expect(mockDel).toHaveBeenCalledWith("/media/abc123?force=true");

		// 验证返回结果
		expect(result).toEqual(mockResult);
	});
});