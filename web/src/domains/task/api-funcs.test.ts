// ── fetchAllTasks：分页接口取全量（列表/看板/依赖图/选择器共用） ──

import type { PaginatedResponse } from "@shared/api";
import { describe, expect, it, vi } from "vite-plus/test";
import { fetchAllTasks, getAllTasksE, getTasksE } from "./api-funcs.ts";
import type { Task } from "./api-types.ts";

vi.mock("@shared/api", () => ({
	buildQuery: vi.fn((params: Record<string, unknown>) => {
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) query.set(key, String(value));
		}
		return query.toString() ? `?${query.toString()}` : "";
	}),
	cachedRequest: vi.fn(),
}));

function page(
	items: number,
	total: number,
	size = 100,
): PaginatedResponse<Task> {
	return {
		items: Array.from({ length: items }, (_, i) => ({ id: i + 1 }) as Task),
		total,
		page: 1,
		page_size: size,
		total_pages: Math.ceil(total / size),
	};
}

describe("fetchAllTasks", () => {
	it("单页够用时只请求一次", async () => {
		const fetchPage = vi.fn(async () => page(33, 33));

		const result = await fetchAllTasks(fetchPage);

		expect(fetchPage).toHaveBeenCalledTimes(1);
		expect(result.items).toHaveLength(33);
		expect(result.truncated).toBe(false);
	});

	it("超过一页时逐页取到 total 为止（缺省每页 100）", async () => {
		const fetchPage = vi.fn(async (p: number) => page(p === 1 ? 100 : 5, 105));

		const result = await fetchAllTasks(fetchPage);

		expect(fetchPage).toHaveBeenNthCalledWith(1, 1, 100);
		expect(fetchPage).toHaveBeenNthCalledWith(2, 2, 100);
		expect(result.items).toHaveLength(105);
		expect(result.total).toBe(105);
		expect(result.truncated).toBe(false);
	});

	it("空页即停：不再继续请求", async () => {
		const fetchPage = vi.fn(async () => page(0, 999));

		const result = await fetchAllTasks(fetchPage);

		expect(fetchPage).toHaveBeenCalledTimes(1);
		expect(result.items).toEqual([]);
		expect(result.truncated).toBe(true); // 取不到 999 条，得让调用点知道
	});

	it("页数上限兜底：超过 10 页只取前 10 页并标 truncated", async () => {
		const fetchPage = vi.fn(async () => page(100, 5000, 100));

		const result = await fetchAllTasks(fetchPage);

		expect(fetchPage).toHaveBeenCalledTimes(10);
		expect(result.items).toHaveLength(1000);
		expect(result.truncated).toBe(true);
		expect(fetchPage).toHaveBeenLastCalledWith(10, 100);
	});

	it("每页都带上后端上限，页面 1 不会退回缺省的 20 条", async () => {
		const fetchPage = vi.fn(async () => page(1, 1));

		await fetchAllTasks(fetchPage);

		expect(fetchPage).toHaveBeenCalledWith(1, 100);
	});
});

describe("任务列表端点", () => {
	it("列表与全量端点都显式带分页参数（不再吃后端缺省的 20 条）", async () => {
		const { cachedRequest } = await import("@shared/api");
		const mocked = vi.mocked(cachedRequest);
		mocked.mockResolvedValue(page(0, 0));

		// 默认排序是 smart（系统算"先做哪件"），所以显式带上 sort
		await getTasksE();
		expect(mocked).toHaveBeenLastCalledWith(
			"/tasks?page=1&page_size=100&sort=smart",
		);

		await getAllTasksE();
		expect(mocked).toHaveBeenLastCalledWith("/tasks/all?page=1&page_size=100");

		await getTasksE(2, 50);
		expect(mocked).toHaveBeenLastCalledWith(
			"/tasks?page=2&page_size=50&sort=smart",
		);

		await getTasksE(1, 100, "due");
		expect(mocked).toHaveBeenLastCalledWith(
			"/tasks?page=1&page_size=100&sort=due",
		);
	});
});
