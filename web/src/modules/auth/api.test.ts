import { beforeEach, describe, expect, it, vi } from "vitest";
import { changePasswordE, loginE, logoutE, registerE } from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	request: vi.fn(),
}));

describe("auth API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("用户登录", async () => {
		// 测试用户登录
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockUser = {
			id: 1,
			name: "testuser",
			role: "user",
			token: "mock-token",
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockUser);

		// 调用登录API
		const result = await loginE("testuser", "password123");

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/user/login", {
			method: "POST",
			body: JSON.stringify({ name: "testuser", password: "password123" }),
		});

		// 验证返回结果
		expect(result).toEqual(mockUser);
	});

	it("用户注册", async () => {
		// 测试用户注册
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockUser = {
			id: 2,
			name: "newuser",
			role: "user",
			token: "new-token",
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockUser);

		// 调用注册API
		const result = await registerE("newuser", "password123");

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/user/register", {
			method: "POST",
			body: JSON.stringify({ name: "newuser", password: "password123" }),
		});

		// 验证返回结果
		expect(result).toEqual(mockUser);
	});

	it("用户登出", async () => {
		// 测试用户登出
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockResult = { ok: true };

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockResult);

		// 调用登出API
		const result = await logoutE();

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/user/logout", {
			method: "POST",
		});

		// 验证返回结果
		expect(result).toEqual(mockResult);
	});

	it("修改密码", async () => {
		// 测试修改密码
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockResult = { ok: true };

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockResult);

		// 调用修改密码API
		const result = await changePasswordE("oldpassword", "newpassword");

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/user/password", {
			method: "POST",
			body: JSON.stringify({
				old_password: "oldpassword",
				new_password: "newpassword",
			}),
		});

		// 验证返回结果
		expect(result).toEqual(mockResult);
	});
});
