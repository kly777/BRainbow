import { describe, expect, it, vi, beforeEach } from "vitest";
import { getMnemonicE, setMnemonicE, getUpcomingCountsE } from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	request: vi.fn(),
	put: vi.fn(),
}));

describe("mem API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("获取助记内容", async () => {
		// 测试获取助记内容
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockMnemonic = { content: "测试助记内容" };

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockMnemonic);

		// 调用获取助记内容API
		const result = await getMnemonicE(1);

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/mem/1/mnemonic", {});

		// 验证返回结果
		expect(result).toEqual(mockMnemonic);
	});

	it("设置助记内容", async () => {
		// 测试设置助记内容
		const { put } = await import("@shared/api");
		const mockPut = vi.mocked(put);

		const mockResult = { ok: true };

		// 模拟put返回成功结果
		mockPut.mockResolvedValueOnce(mockResult);

		// 调用设置助记内容API
		const result = await setMnemonicE(1, "新助记内容");

		// 验证put被调用
		expect(mockPut).toHaveBeenCalledTimes(1);
		expect(mockPut).toHaveBeenCalledWith("/mem/1/mnemonic", {
			content: "新助记内容",
		});

		// 验证返回结果
		expect(result).toEqual(mockResult);
	});

	it("获取即将到来的复习数量", async () => {
		// 测试获取即将到来的复习数量
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);

		const mockCounts = { within_8h: 5, within_24h: 12 };

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockCounts);

		// 调用获取即将到来的复习数量API
		const result = await getUpcomingCountsE();

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/mem/upcoming-counts", {});

		// 验证返回结果
		expect(result).toEqual(mockCounts);
	});
});
