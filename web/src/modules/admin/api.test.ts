import { describe, expect, it, vi, beforeEach } from "vitest";
import { getAdminSettingsE, updateAdminSettingsE, rotateJwtE } from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	request: vi.fn(),
}));

describe("admin API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("获取管理员设置", async () => {
		// 测试获取管理员设置
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockSettings = {
			allow_register: true,
			jwt_secret_set: true,
			jwt_secret_len: 32,
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockSettings);

		// 调用获取管理员设置API
		const result = await getAdminSettingsE();

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/admin/settings", {});

		// 验证返回结果
		expect(result).toEqual(mockSettings);
	});

	it("更新管理员设置", async () => {
		// 测试更新管理员设置
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockSettings = {
			allow_register: false,
			jwt_secret_set: true,
			jwt_secret_len: 32,
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockSettings);

		// 调用更新管理员设置API
		const result = await updateAdminSettingsE(false);

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/admin/settings", {
			method: "PATCH",
			body: JSON.stringify({ allow_register: false }),
		});

		// 验证返回结果
		expect(result).toEqual(mockSettings);
	});

	it("轮换JWT密钥", async () => {
		// 测试轮换JWT密钥
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockResult = { ok: true, message: "JWT密钥已轮换" };

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockResult);

		// 调用轮换JWT密钥API
		const result = await rotateJwtE();

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/admin/settings/jwt/rotate", {
			method: "POST",
		});

		// 验证返回结果
		expect(result).toEqual(mockResult);
	});
});
