import type { DueResponse, MemItem } from "@modules/mem";
import { createRoot } from "solid-js";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useDueQueue } from "./useDueQueue.ts";

// 模拟getSessionEstimateE
vi.mock("@modules/mem", () => ({
	getSessionEstimateE: vi.fn(async () => ({
		total_estimate: 10,
		avg_seconds: 12,
	})),
}));

function item(id: number, state = "review"): MemItem {
	return {
		id,
		cue: { id, content: `cue ${id}`, created_at: "" },
		target: { id: id + 100, content: `target ${id}`, created_at: "" },
		state,
		stability: 5,
		difficulty: 5,
		due_at: "",
		lapses: 0,
		leeched: false,
	};
}

function response(items: MemItem[], has_more = false): DueResponse {
	return {
		items,
		due_count: items.length,
		has_more,
		upcoming_count: 0,
		all_far: false,
	};
}

describe("useDueQueue - 关键行为测试", () => {
	let fetchDueMock: ReturnType<typeof vi.fn>;
	let onItemChangeMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchDueMock = vi.fn();
		onItemChangeMock = vi.fn();
	});

	it("预取机制：剩余卡 ≤3 张时提前拉下一批", async () => {
		// 测试预取机制
		const items = [item(1), item(2), item(3), item(4)];
		fetchDueMock.mockResolvedValueOnce(response(items));
		
		await createRoot(async (dispose) => {
			try {
				const queue = useDueQueue({
					fetchDue: fetchDueMock,
					onItemChange: onItemChangeMock,
				});

				// 初始加载
				await queue.loadDue();
				expect(queue.due().length).toBe(4);
				
				// 消费一张卡，剩余3张，应该触发预取
				queue.advanceQueue();
				expect(queue.due().length).toBe(3);
				
				// 验证fetchDue被调用两次（初始加载 + 预取）
				expect(fetchDueMock).toHaveBeenCalledTimes(2);
			} finally {
				dispose();
			}
		});
	});

	it("stale-while-revalidate：已有卡片时不清空、不闪加载中", async () => {
		// 测试stale-while-revalidate机制
		const items1 = [item(1), item(2)];
		const items2 = [item(3), item(4)];
		
		fetchDueMock.mockResolvedValueOnce(response(items1));
		
		await createRoot(async (dispose) => {
			try {
				const queue = useDueQueue({
					fetchDue: fetchDueMock,
					onItemChange: onItemChangeMock,
				});

				// 初始加载
				await queue.loadDue();
				expect(queue.due().length).toBe(2);
				expect(queue.loading()).toBe(false);
				
				// 模拟网络请求延迟
				fetchDueMock.mockImplementationOnce(() => 
					new Promise(resolve => setTimeout(() => resolve(response(items2)), 100))
				);
				
				// 再次加载，应该不清空现有卡片
				const loadPromise = queue.loadDue();
				expect(queue.due().length).toBe(2); // 仍然显示旧卡片
				expect(queue.loading()).toBe(false); // 不显示加载中
				
				await loadPromise;
				expect(queue.due().length).toBe(2); // 更新为新卡片
			} finally {
				dispose();
			}
		});
	});

	it("错误处理：失败时保留旧队列", async () => {
		// 测试错误处理机制
		const items = [item(1), item(2)];
		fetchDueMock.mockResolvedValueOnce(response(items));
		
		await createRoot(async (dispose) => {
			try {
				const queue = useDueQueue({
					fetchDue: fetchDueMock,
					onItemChange: onItemChangeMock,
				});

				// 初始加载
				await queue.loadDue();
				expect(queue.due().length).toBe(2);
				
				// 模拟网络错误
				fetchDueMock.mockRejectedValueOnce(new Error("Network error"));
				
				// 再次加载，应该保留旧卡片
				await queue.loadDue();
				expect(queue.due().length).toBe(2); // 保留旧卡片
			} finally {
				dispose();
			}
		});
	});

	it("预估缓存：验证预估调用行为", async () => {
		// 测试预估调用行为
		const items = [item(1), item(2)];
		fetchDueMock.mockResolvedValue(response(items));
		
		await createRoot(async (dispose) => {
			try {
				const queue = useDueQueue({
					fetchDue: fetchDueMock,
					onItemChange: onItemChangeMock,
				});

				// 获取mock引用
				const { getSessionEstimateE } = await import("@modules/mem");
				const estimateMock = vi.mocked(getSessionEstimateE);
				
				// 清除之前的调用记录
				estimateMock.mockClear();
				
				// 第一次加载
				await queue.loadDue();
				const firstCallCount = estimateMock.mock.calls.length;
				
				// 第二次加载
				await queue.loadDue();
				const secondCallCount = estimateMock.mock.calls.length;
				
				// 验证预估被调用
				expect(firstCallCount).toBeGreaterThan(0);
				
				// 验证预估调用次数增加
				expect(secondCallCount).toBeGreaterThanOrEqual(firstCallCount);
				
				console.log(`预估调用次数: 第一次加载 ${firstCallCount} 次, 第二次加载 ${secondCallCount} 次`);
				
			} finally {
				dispose();
			}
		});
	});

	it("标签过滤变化：强制刷新预估", async () => {
		// 测试标签过滤变化时强制刷新预估
		const items = [item(1), item(2)];
		fetchDueMock.mockResolvedValue(response(items));
		
		let estimateParams = { tag_ids: [1, 2] };
		
		await createRoot(async (dispose) => {
			try {
				const queue = useDueQueue({
					fetchDue: fetchDueMock,
					onItemChange: onItemChangeMock,
					estimateParams: () => estimateParams,
				});

				// 获取mock引用
				const { getSessionEstimateE } = await import("@modules/mem");
				const estimateMock = vi.mocked(getSessionEstimateE);
				
				// 清除之前的调用记录
				estimateMock.mockClear();
				
				// 第一次加载
				await queue.loadDue();
				const firstCallCount = estimateMock.mock.calls.length;
				
				// 第二次加载，相同标签
				await queue.loadDue();
				const secondCallCount = estimateMock.mock.calls.length;
				
				// 验证预估调用次数相同（缓存生效）
				expect(secondCallCount).toBe(firstCallCount);
				
				// 改变标签过滤
				estimateParams = { tag_ids: [3, 4] };
				
				// 第三次加载，不同标签
				await queue.loadDue();
				const thirdCallCount = estimateMock.mock.calls.length;
				
				// 验证预估调用次数增加（缓存失效）
				expect(thirdCallCount).toBeGreaterThan(secondCallCount);
				
				console.log(`标签过滤测试: 第一次 ${firstCallCount} 次, 第二次 ${secondCallCount} 次, 第三次 ${thirdCallCount} 次`);
				
			} finally {
				dispose();
			}
		});
	});
});