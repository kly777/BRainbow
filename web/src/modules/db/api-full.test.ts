import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	getTablesE,
	getTableDataE,
	getBackRefsE,
	downloadTableExport,
} from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	cachedRequest: vi.fn(),
	requestFile: vi.fn(),
}));

vi.mock("@shared/utils", () => ({
	downloadBlob: vi.fn(),
}));

describe("db API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("获取数据库表列表", async () => {
		// 测试获取数据库表列表
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockTables = ["users", "tasks", "cards"];

		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockTables);

		// 调用获取数据库表列表API
		const result = await getTablesE();

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith("/db");

		// 验证返回结果
		expect(result).toEqual(mockTables);
	});

	it("获取表数据", async () => {
		// 测试获取表数据
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockTableData = {
			header: [
				{ name: "id", col_type: "INTEGER", is_primary: true },
				{ name: "name", col_type: "TEXT", is_primary: false },
			],
			rows: [
				[1, "测试用户"],
				[2, "测试用户2"],
			],
			total: 2,
			refs: [],
		};

		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockTableData);

		// 调用获取表数据API
		const result = await getTableDataE("users", { page: 1, page_size: 50 });

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith(
			"/db/users?page=1&page_size=50",
		);

		// 验证返回结果
		expect(result).toEqual(mockTableData);
	});

	it("获取反向引用", async () => {
		// 测试获取反向引用
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockBackRefs = [
			{
				source_table: "tasks",
				column: "user_id",
				total: 2,
				rows: [
					{ key: 1, summary: "任务1" },
					{ key: 2, summary: "任务2" },
				],
			},
		];

		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockBackRefs);

		// 调用获取反向引用API
		const result = await getBackRefsE("users", 1);

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith("/db/users/backrefs?id=1");

		// 验证返回结果
		expect(result).toEqual(mockBackRefs);
	});

	it("下载表导出", async () => {
		// 测试下载表导出
		const { requestFile } = await import("@shared/api");
		const mockRequestFile = vi.mocked(requestFile);
		const { downloadBlob } = await import("@shared/utils");
		const mockDownloadBlob = vi.mocked(downloadBlob);

		const mockResponse = {
			blob: vi.fn().mockResolvedValue(new Blob(["test"])),
			headers: {
				get: vi.fn().mockReturnValue('filename="test.csv"'),
			},
		};

		// 模拟requestFile返回成功结果
		mockRequestFile.mockResolvedValueOnce(mockResponse);

		// 调用下载表导出API
		await downloadTableExport("users", { format: "csv" });

		// 验证requestFile被调用
		expect(mockRequestFile).toHaveBeenCalledTimes(1);
		expect(mockRequestFile).toHaveBeenCalledWith("/db/users/export?format=csv");

		// 验证downloadBlob被调用
		expect(mockDownloadBlob).toHaveBeenCalledTimes(1);
	});
});
