import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	activateTaskE,
	archiveTaskE,
	completeTaskE,
	createTaskE,
	deleteTaskE,
	getTaskStatsE,
	getTaskTreeE,
	moveToBacklogE,
	searchTasksE,
	updateTaskE,
} from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	request: vi.fn(),
	post: vi.fn(),
	patch: vi.fn(),
	buildQuery: vi.fn((params) => {
		const query = new URLSearchParams();
		Object.entries(params).forEach(([key, value]) => {
			if (value !== undefined) query.set(key, String(value));
		});
		return query.toString() ? `?${query.toString()}` : "";
	}),
	cachedRequest: vi.fn(),
	domains: {
		tasks: {
			invalidate: vi.fn((promise) => promise),
		},
	},
}));

describe("task API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("获取任务树", async () => {
		// 测试获取任务树
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockTree = [
			{
				task: {
					id: 1,
					title: "测试任务",
					description: "任务描述",
					status: "active",
					priority: "high",
					created_at: "2024-01-01",
					updated_at: "2024-01-01",
				},
				children: [],
			},
		];

		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockTree);

		// 调用获取任务树API
		const result = await getTaskTreeE();

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith("/tasks/tree");

		// 验证返回结果
		expect(result).toEqual(mockTree);
	});

	it("创建任务", async () => {
		// 测试创建任务
		const { post, domains } = await import("@shared/api");
		const mockPost = vi.mocked(post);
		const mockDomains = vi.mocked(domains);

		const mockTask = {
			id: 2,
			title: "新任务",
			description: "新任务描述",
			status: "backlog",
			priority: "medium",
			created_at: "2024-01-02",
			updated_at: "2024-01-02",
		};

		// 模拟post返回成功结果
		mockPost.mockResolvedValueOnce(mockTask);
		// @ts-expect-error - mock type mismatch
		mockDomains.tasks.invalidate.mockImplementationOnce((promise) => promise);

		// 调用创建任务API
		const result = await createTaskE({
			title: "新任务",
			description: "新任务描述",
		});

		// 验证post被调用
		expect(mockPost).toHaveBeenCalledTimes(1);
		expect(mockPost).toHaveBeenCalledWith("/tasks", {
			title: "新任务",
			description: "新任务描述",
		});

		// 验证返回结果
		expect(result).toEqual(mockTask);
	});

	it("更新任务", async () => {
		// 测试更新任务
		const { patch, domains } = await import("@shared/api");
		const mockPatch = vi.mocked(patch);
		const mockDomains = vi.mocked(domains);

		const mockTask = {
			id: 1,
			title: "更新后的任务",
			description: "更新后的描述",
			status: "active",
			priority: "high",
			created_at: "2024-01-01",
			updated_at: "2024-01-02",
		};

		// 模拟patch返回成功结果
		mockPatch.mockResolvedValueOnce(mockTask);
		// @ts-expect-error - mock type mismatch
		mockDomains.tasks.invalidate.mockImplementationOnce((promise) => promise);

		// 调用更新任务API
		const result = await updateTaskE(1, { title: "更新后的任务" });

		// 验证patch被调用
		expect(mockPatch).toHaveBeenCalledTimes(1);
		expect(mockPatch).toHaveBeenCalledWith("/tasks/1", {
			title: "更新后的任务",
		});

		// 验证返回结果
		expect(result).toEqual(mockTask);
	});

	it("删除任务", async () => {
		// 测试删除任务
		const { request, domains } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		const mockDomains = vi.mocked(domains);

		const mockResult = { ok: true };

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockResult);
		// @ts-expect-error - mock type mismatch
		mockDomains.tasks.invalidate.mockImplementationOnce((promise) => promise);

		// 调用删除任务API
		const result = await deleteTaskE(1);

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/tasks/1", { method: "DELETE" });

		// 验证返回结果
		expect(result).toEqual(mockResult);
	});

	it("任务状态操作", async () => {
		// 测试任务状态操作
		const { request, domains } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		const mockDomains = vi.mocked(domains);

		const mockTask = {
			id: 1,
			title: "测试任务",
			description: "任务描述",
			status: "completed",
			priority: "high",
			created_at: "2024-01-01",
			updated_at: "2024-01-02",
		};

		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockTask);
		// @ts-expect-error - mock type mismatch
		mockDomains.tasks.invalidate.mockImplementationOnce((promise) => promise);

		// 调用完成任务API
		const result = await completeTaskE(1);

		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/tasks/1/complete", {
			method: "POST",
		});

		// 验证返回结果
		expect(result).toEqual(mockTask);
	});

	it("搜索任务", async () => {
		// 测试搜索任务
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockResponse = {
			items: [
				{
					id: 1,
					title: "测试任务",
					description: "任务描述",
					status: "active",
					priority: "high",
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

		// 调用搜索任务API
		const result = await searchTasksE("测试");

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith(
			"/tasks/search?q=%E6%B5%8B%E8%AF%95",
		);

		// 验证返回结果
		expect(result).toEqual(mockResponse);
	});

	it("获取任务统计", async () => {
		// 测试获取任务统计
		const { cachedRequest } = await import("@shared/api");
		const mockCachedRequest = vi.mocked(cachedRequest);

		const mockStats = {
			backlog: 5,
			active: 3,
			completed: 10,
			archived: 2,
		};

		// 模拟cachedRequest返回成功结果
		mockCachedRequest.mockResolvedValueOnce(mockStats);

		// 调用获取任务统计API
		const result = await getTaskStatsE();

		// 验证cachedRequest被调用
		expect(mockCachedRequest).toHaveBeenCalledTimes(1);
		expect(mockCachedRequest).toHaveBeenCalledWith("/tasks/stats");

		// 验证返回结果
		expect(result).toEqual(mockStats);
	});
});
