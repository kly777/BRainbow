import { describe, expect, it, vi, beforeEach } from "vitest";
import { listKeysE, createKeyE, deleteKeyE } from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	get: vi.fn(),
	post: vi.fn(),
	del: vi.fn(),
}));

describe("key API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("获取API Key列表", async () => {
		// 测试获取API Key列表
		const { get } = await import("@shared/api");
		const mockGet = vi.mocked(get);

		const mockKeys = [
			{ id: 1, role: "user", created_at: "2024-01-01" },
			{ id: 2, role: "admin", created_at: "2024-01-02" },
		];

		// 模拟get返回成功结果
		mockGet.mockResolvedValueOnce(mockKeys);

		// 调用获取API Key列表API
		const result = await listKeysE();

		// 验证get被调用
		expect(mockGet).toHaveBeenCalledTimes(1);
		expect(mockGet).toHaveBeenCalledWith("/auth/keys");

		// 验证返回结果
		expect(result).toEqual(mockKeys);
	});

	it("创建新的API Key", async () => {
		// 测试创建新的API Key
		const { post } = await import("@shared/api");
		const mockPost = vi.mocked(post);

		const mockKey = {
			id: 3,
			role: "user",
			created_at: "2024-01-03",
			key: "sk-1234567890",
		};

		// 模拟post返回成功结果
		mockPost.mockResolvedValueOnce(mockKey);

		// 调用创建新的API Key API
		const result = await createKeyE();

		// 验证post被调用
		expect(mockPost).toHaveBeenCalledTimes(1);
		expect(mockPost).toHaveBeenCalledWith("/auth/key", {});

		// 验证返回结果
		expect(result).toEqual(mockKey);
	});

	it("删除API Key", async () => {
		// 测试删除API Key
		const { del } = await import("@shared/api");
		const mockDel = vi.mocked(del);

		const mockResult = { ok: true };

		// 模拟del返回成功结果
		mockDel.mockResolvedValueOnce(mockResult);

		// 调用删除API Key API
		const result = await deleteKeyE(1);

		// 验证del被调用
		expect(mockDel).toHaveBeenCalledTimes(1);
		expect(mockDel).toHaveBeenCalledWith("/auth/key/1");

		// 验证返回结果
		expect(result).toEqual(mockResult);
	});
});
