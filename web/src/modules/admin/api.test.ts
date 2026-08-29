import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAdminSettingsE,
	getSystemInfoE,
	rotateJwtE,
	updateAdminSettingsE,
} from "./api.ts";

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

	it("获取系统信息", async () => {
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockSystemInfo = {
			version: "0.1.0",
			uptime_secs: 86400,
			db_version: 12,
			db_page_count: 1024,
			db_page_size: 4096,
			db_size_bytes: 4194304,
			stats: {
				users: 5,
				tasks: 42,
				cards: 128,
				memories: 256,
				bookmarks: 30,
				articles: 12,
				conversations: 8,
				chat_trees: 15,
				ontologies: 3,
			},
		};

		mockRequest.mockResolvedValueOnce(mockSystemInfo);

		const result = await getSystemInfoE();

		expect(mockRequest).toHaveBeenCalledWith("/admin/system-info", {});
		expect(result).toEqual(mockSystemInfo);
		expect(result.version).toBe("0.1.0");
		expect(result.stats.tasks).toBe(42);
	});
});
