// ── useCardsList 列表生命周期（测试覆盖扩充）──
// 乐观删除回滚 / 创建前置插入 / 分页守卫 / 加载更多终止条件。

import {
	createCardE,
	deleteCardE,
	getCardsE,
	searchCardsE,
} from "@modules/card";
import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCardsList } from "./useCardsList.ts";

vi.mock("@modules/card/api.ts", () => ({
	createCardE: vi.fn(),
	deleteCardE: vi.fn(),
	getCardsE: vi.fn(),
	searchCardsE: vi.fn(),
}));
let urlQ = "";
vi.mock("@solidjs/router", () => ({
	useSearchParams: () => [
		{
			get q() {
				return urlQ;
			},
		},
		vi.fn(),
	],
}));
const confirmResolve = vi.fn();
const tryOrNotifyImpl = vi.fn();
vi.mock("@shared/utils", async (importOriginal) => {
	const mod = await importOriginal<typeof import("@shared/utils")>();
	return {
		...mod,
		showConfirm: () => confirmResolve(),
		tryOrNotify: (fn: () => Promise<unknown>, ctx: string) =>
			tryOrNotifyImpl(fn, ctx),
	};
});
vi.mock("@shared/utils/toastStore.ts", () => ({ showToast: vi.fn() }));

const mockedCreate = vi.mocked(createCardE);
const mockedDelete = vi.mocked(deleteCardE);
const mockedGet = vi.mocked(getCardsE);
const mockedSearch = vi.mocked(searchCardsE);
const card = (id: number) => ({
	id,
	content: `c${id}`,
	created_at: "2026-08-22T00:00:00+00:00",
	updated_at: "2026-08-22T00:00:00+00:00",
});
const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * 通过数据源播种列表状态（而不是直接改 hook 内部信号）——
 * 迁到 useListResource 后列表由 createResource 持有，只能经请求驱动，
 * 这样测的也更接近真实路径。
 */
async function seed(
	h: ReturnType<typeof useCardsList>,
	items: ReturnType<typeof card>[],
	totalPages = 1,
) {
	// 保留给"挂载后需要换数据"的场景；常规播种请用 withHook 的第二参数
	mockedGet.mockResolvedValue(paginated(items, 1, totalPages));
	for (let i = 0; i < 50 && h.cards().length !== items.length; i++)
		await flush();
}

/** 轮询等待条件成立（资源值提交在微任务之后，单次 await 不够稳） */
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

const paginated = (
	items: ReturnType<typeof card>[],
	page: number,
	total_pages: number,
) => ({
	items,
	page,
	total_pages,
	total: items.length,
	page_size: 20,
});

beforeEach(() => {
	vi.clearAllMocks();
	urlQ = "";
	confirmResolve.mockResolvedValue(true);
	tryOrNotifyImpl.mockImplementation(async (fn: () => Promise<unknown>) =>
		fn(),
	);
});

function withHook<T>(
	fn: (h: ReturnType<typeof useCardsList>) => T | Promise<T>,
	/**
	 * 初始列表数据：**在创建 hook 之前**设好 mock，让挂载时的首次拉取直接
	 * 消费它。挂载后再 refetch 不可靠 —— 首次拉取尚未结算时 refetch 只会
	 * 拿到那个 in-flight 的 promise，不会真正发起新请求。
	 */
	initial?: { items: ReturnType<typeof card>[]; totalPages?: number },
) {
	return new Promise<T>((resolve) => {
		createRoot(async (dispose) => {
			if (initial)
				mockedGet.mockResolvedValue(
					paginated(initial.items, 1, initial.totalPages ?? 1),
				);
			const h = useCardsList();
			try {
				resolve(await fn(h));
			} finally {
				dispose();
			}
		});
	});
}

describe("handleCardDelete", () => {
	it("取消确认时不删除", () => {
		return withHook(
			async (h) => {
				await settle(() => h.cards().length === 2);
				confirmResolve.mockResolvedValue(false);
				await h.handleCardDelete(1);
				expect(mockedDelete).not.toHaveBeenCalled();
				expect(h.cards().length).toBe(2);
			},
			{ items: [card(1), card(2)] },
		);
	});

	it("成功删除走乐观移除并复位删除态", () => {
		return withHook(async (h) => {
			await seed(h, [card(1), card(2)]);
			mockedDelete.mockResolvedValue(undefined);
			await h.handleCardDelete(1);
			expect(mockedDelete).toHaveBeenCalledWith(1);
			expect(h.cards().map((c) => c.id)).toEqual([2]);
			expect(h.deletingCardId()).toBeNull();
		});
	});

	it("删除失败回滚原列表", () => {
		return withHook(async (h) => {
			await seed(h, [card(1), card(2)]);
			mockedDelete.mockRejectedValue(new Error("外键约束"));
			await h.handleCardDelete(1);
			expect(mockedDelete).toHaveBeenCalledOnce();
			expect(h.cards().map((c) => c.id)).toEqual([1, 2]);
			expect(h.deletingCardId()).toBeNull();
		});
	});
});

describe("handleCreateCard", () => {
	it("空内容拒绝且不发请求", () => {
		return withHook(async (h) => {
			h.setNewCardContent(" ");
			await h.handleCreateCard();
			// 表单校验失败只标弹窗；此前误设为列表 error，会让整个列表变错误态
			expect(h.modalError()).toBe("内容不能为空");
			expect(h.error()).toBeNull();
			expect(mockedCreate).not.toHaveBeenCalled();
		});
	});

	it("成功后前置插入、清空输入并关闭弹窗", () => {
		return withHook(async (h) => {
			await seed(h, [card(9)]);
			h.setShowCreateModal(true);
			h.setNewCardContent("  新卡片  ");
			mockedCreate.mockResolvedValue(card(10));
			await h.handleCreateCard();
			expect(mockedCreate).toHaveBeenCalledWith({ content: "新卡片" });
			expect(h.cards()[0].id).toBe(10);
			expect(h.newCardContent()).toBe("");
			expect(h.showCreateModal()).toBe(false);
			expect(h.isCreating()).toBe(false);
		});
	});
});

describe("分页与加载更多", () => {
	it("handlePageChange 越界不加载", () => {
		return withHook(async (h) => {
			await seed(h, [], 3);
			mockedGet.mockClear();
			await h.handlePageChange(0);
			await h.handlePageChange(4);
			await flush();
			expect(mockedGet).not.toHaveBeenCalled();
		});
	});

	it("handlePageChange 合法页按当前模式加载", () => {
		return withHook(async (h) => {
			await seed(h, [card(1)], 3);
			mockedGet.mockResolvedValue(paginated([card(5)], 2, 3));
			h.handlePageChange(2);
			await flush();
			expect(mockedGet).toHaveBeenCalledWith(2);
			expect(h.cards()[0].id).toBe(5);
			expect(h.page()).toBe(2);
			expect(h.loading()).toBe(false);
		});
	});

	it("handleLoadMore 追加并在末页置 hasMore=false 且防重入", () => {
		return withHook(
			async (h) => {
				await settle(() => h.cards().length === 1);
				mockedGet.mockResolvedValue(paginated([card(2)], 2, 2));
				await h.handleLoadMore();
				await settle(() => h.cards().length === 2);
				expect(h.cards().map((c) => c.id)).toEqual([1, 2]);
				expect(h.hasMore()).toBe(false);
				expect(h.loadingMore()).toBe(false);
				const callsAfterAppend = mockedGet.mock.calls.length;
				await h.handleLoadMore();
				expect(mockedGet.mock.calls.length).toBe(callsAfterAppend);
			},
			{ items: [card(1)], totalPages: 2 },
		);
	});

	it("加载更多把新一页追加到已加载的后面（不是整份替换）", () => {
		// 回归：真实事故是"列表只剩最后一页"。触发条件是**每一页的数据不同** ——
		// 若加载更多顺手改了数据源的分页号，资源会按新分页号重取一次，返回的只有
		// 那一页，于是刚 patch 进去的累积列表被整份换掉。上面那条测试两页返回同一份
		// mock，恰好掩盖了这个差别。
		const page1 = Array.from({ length: 20 }, (_, i) => card(100 + i));
		const page2 = Array.from({ length: 5 }, (_, i) => card(200 + i));
		return withHook(
			async (h) => {
				await settle(() => h.cards().length === 20);
				mockedGet.mockImplementation(async (p = 1) =>
					p === 2 ? paginated(page2, 2, 2) : paginated(page1, 1, 2),
				);

				await h.handleLoadMore();
				await settle(() => h.cards().length === 25);

				// 只应发一次请求：不能因为改了分页号再取一次那一页
				expect(mockedGet.mock.calls.filter((c) => c[0] === 2).length).toBe(1);

				expect(h.cards().length).toBe(25);
				expect(
					h
						.cards()
						.map((c) => c.id)
						.slice(0, 20),
				).toEqual(page1.map((c) => c.id));
				expect(h.cards().at(-1)?.id).toBe(204);
				expect(h.hasMore()).toBe(false);
			},
			{ items: page1, totalPages: 2 },
		);
	});

	it("搜索态下翻页与加载更多走 searchCardsE", () => {
		return withHook(async (h) => {
			mockedSearch.mockResolvedValue(paginated([card(6)], 1, 3));
			h.handleSearch("量子");
			await settle(() => h.cards().some((c) => c.id === 6));
			expect(mockedSearch).toHaveBeenCalledWith("量子", 1);

			// 挂载时资源会先拉一次（这正是页面不再需要 loadInitial 的原因），
			// 故断言"进入搜索态后不再走非搜索接口"，而不是"从未调用"
			const getCallsBefore = mockedGet.mock.calls.length;
			mockedSearch.mockResolvedValue(paginated([card(7)], 2, 3));
			h.handlePageChange(2);
			await settle(() => h.cards().some((c) => c.id === 7));
			expect(mockedSearch).toHaveBeenLastCalledWith("量子", 2);
			expect(mockedGet.mock.calls.length).toBe(getCallsBefore);

			mockedSearch.mockResolvedValue(paginated([card(8)], 3, 3));
			await h.handleLoadMore();
			await settle(() => h.cards().some((c) => c.id === 8));
			expect(mockedSearch).toHaveBeenLastCalledWith("量子", 3);
			expect(h.cards().at(-1)?.id).toBe(8);
		});
	});

	it("初始 URL q 作深链接种子；清空后退出搜索态并清理 URL", () => {
		urlQ = "关键词";
		return withHook(async (h) => {
			expect(h.searchQuery()).toBe("关键词");
			expect(h.isSearchMode()).toBe(true);

			mockedGet.mockResolvedValue(paginated([], 1, 0));
			h.handleSearch("");
			await flush();
			expect(h.searchQuery()).toBe("");
			expect(h.isSearchMode()).toBe(false);
			expect(mockedGet).toHaveBeenCalledWith(1);
		});
	});
});
