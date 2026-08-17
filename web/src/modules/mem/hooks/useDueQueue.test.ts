import type { DueResponse, MemItem } from "@modules/mem";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { useDueQueue } from "./useDueQueue.ts";

vi.mock("@modules/mem", () => ({
	getSessionEstimateE: vi.fn(async () => ({
		total_estimate: 10,
		avg_seconds: 12,
	})),
}));

function item(id: number): MemItem {
	return {
		id,
		cue: { id, content: `cue ${id}`, created_at: "" },
		target: { id: id + 100, content: `target ${id}`, created_at: "" },
		state: "review",
		stability: 5,
		difficulty: 5,
		due_at: "",
		lapses: 0,
		leeched: false,
	};
}

function response(items: MemItem[]): DueResponse {
	return {
		items,
		due_count: items.length,
		has_more: false,
		upcoming_count: 0,
		all_far: false,
	};
}

function runInRoot<T>(
	fn: (queue: ReturnType<typeof useDueQueue>) => Promise<T>,
): Promise<T> {
	return createRoot(async (dispose) => {
		try {
			return await fn(
				useDueQueue({
					fetchDue: async () => response([item(1), item(2), item(3)]),
					onItemChange: () => {},
				}),
			);
		} finally {
			dispose();
		}
	});
}

describe("useDueQueue", () => {
	it("加载队列并消费当前卡", async () => {
		await runInRoot(async (q) => {
			await q.loadDue();
			expect(q.due().map((it) => it.id)).toEqual([1, 2, 3]);
			expect(q.current()).toBe(0);

			q.advanceQueue();
			expect(q.due().map((it) => it.id)).toEqual([2, 3]);
			expect(q.current()).toBe(0);
		});
	});

	it("Again 后当前卡隔几张再次出现", async () => {
		await runInRoot(async (q) => {
			await q.loadDue();
			q.revisitCurrent(1);
			// card 1 的 again gap = 1 + (1 % 2) = 2
			expect(q.due().map((it) => it.id)).toEqual([2, 3, 1]);
			expect(q.current()).toBe(0);
		});
	});

	it("Hard 后当前卡隔更远再次出现", async () => {
		await runInRoot(async (q) => {
			await q.loadDue();
			q.revisitCurrent(2);
			// card 1 的 hard gap = 4 + (1 % 3) = 5，队列只有 3 张 → 夹紧到末尾
			expect(q.due().map((it) => it.id)).toEqual([2, 3, 1]);
			expect(q.current()).toBe(0);
		});
	});

	it("达到重插上限后按正常消费移除", async () => {
		await runInRoot(async (q) => {
			await q.loadDue();
			// card 1 第一次重插到后面
			q.revisitCurrent(1);
			expect(q.due().map((it) => it.id)).toEqual([2, 3, 1]);
			// 消费掉中间卡，让 card 1 再次成为当前卡
			q.advanceQueue();
			q.advanceQueue();
			expect(q.due().map((it) => it.id)).toEqual([1]);
			// 单卡队列中继续重插两次（第 2、3 次）
			q.revisitCurrent(1);
			q.revisitCurrent(1);
			expect(q.due().map((it) => it.id)).toEqual([1]);
			// 第 4 次触发上限 → 直接出队
			q.revisitCurrent(1);
			expect(q.due()).toEqual([]);
			expect(q.reviewedIds.has(1)).toBe(true);
		});
	});
});
