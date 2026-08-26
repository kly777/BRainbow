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

vi.mock("@modules/card", () => ({
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
vi.mock("@lib/utils", async (importOriginal) => {
	const mod = await importOriginal<typeof import("@lib/utils")>();
	return {
		...mod,
		showConfirm: () => confirmResolve(),
		tryOrNotify: (fn: () => Promise<unknown>, ctx: string) =>
			tryOrNotifyImpl(fn, ctx),
	};
});
vi.mock("@components/ui", () => ({ showToast: vi.fn() }));

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
) {
	return new Promise<T>((resolve) => {
		createRoot(async (dispose) => {
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
		return withHook(async (h) => {
			h.setCards([card(1), card(2)]);
			confirmResolve.mockResolvedValue(false);
			await h.handleCardDelete(1);
			expect(mockedDelete).not.toHaveBeenCalled();
			expect(h.cards().length).toBe(2);
		});
	});

	it("成功删除走乐观移除并复位删除态", () => {
		return withHook(async (h) => {
			h.setCards([card(1), card(2)]);
			mockedDelete.mockResolvedValue(undefined);
			await h.handleCardDelete(1);
			expect(mockedDelete).toHaveBeenCalledWith(1);
			expect(h.cards().map((c) => c.id)).toEqual([2]);
			expect(h.deletingCardId()).toBeNull();
		});
	});

	it("删除失败回滚原列表", () => {
		return withHook(async (h) => {
			h.setCards([card(1), card(2)]);
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
			expect(h.error()).toBe("内容不能为空");
			expect(mockedCreate).not.toHaveBeenCalled();
		});
	});

	it("成功后前置插入、清空输入并关闭弹窗", () => {
		return withHook(async (h) => {
			h.setCards([card(9)]);
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
			h.setTotalPages(3);
			await h.handlePageChange(0);
			await h.handlePageChange(4);
			expect(mockedGet).not.toHaveBeenCalled();
		});
	});

	it("handlePageChange 合法页按当前模式加载", () => {
		return withHook(async (h) => {
			h.setTotalPages(3);
			mockedGet.mockResolvedValue(paginated([card(5)], 2, 3));
			await h.handlePageChange(2);
			expect(mockedGet).toHaveBeenCalledWith(2);
			expect(h.cards()[0].id).toBe(5);
			expect(h.page()).toBe(2);
			expect(h.loading()).toBe(false);
		});
	});

	it("handleLoadMore 追加并在末页置 hasMore=false 且防重入", () => {
		return withHook(async (h) => {
			h.setCards([card(1)]);
			h.setPage(1);
			h.setTotalPages(2);
			mockedGet.mockResolvedValue(paginated([card(2)], 2, 2));
			await h.handleLoadMore();
			expect(h.cards().map((c) => c.id)).toEqual([1, 2]);
			expect(h.hasMore()).toBe(false);
			expect(h.loadingMore()).toBe(false);
			await h.handleLoadMore();
			expect(mockedGet).toHaveBeenCalledOnce();
		});
	});

	it("搜索态下翻页与加载更多走 searchCardsE", () => {
		return withHook(async (h) => {
			mockedSearch.mockResolvedValue(paginated([card(6)], 1, 3));
			await h.handleSearch("量子");
			expect(mockedSearch).toHaveBeenCalledWith("量子", 1);

			h.setTotalPages(3);
			mockedSearch.mockResolvedValue(paginated([card(7)], 2, 3));
			await h.handlePageChange(2);
			expect(mockedSearch).toHaveBeenLastCalledWith("量子", 2);
			expect(mockedGet).not.toHaveBeenCalled();

			mockedSearch.mockResolvedValue(paginated([card(8)], 3, 3));
			await h.handleLoadMore();
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
			await h.handleSearch("");
			expect(h.searchQuery()).toBe("");
			expect(h.isSearchMode()).toBe(false);
			expect(mockedGet).toHaveBeenCalledWith(1);
		});
	});
});
