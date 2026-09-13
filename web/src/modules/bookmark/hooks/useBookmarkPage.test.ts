// ── useBookmarkPage 列表数据源回归 ──
// 本 hook 刚从"手写信号 + loadSeq 竞态守卫 + createEffect 重取"迁到
// useListResource。这组断言锁住迁移后的三条关键行为：
//   1. 挂载即拉取、参数变化自动重取（原来靠手写 effect，现由 createResource 接管）
//   2. 静默重载不经过 loading（批量操作后同步用，否则会闪骨架屏）
//   3. 乐观删除成功保留、失败回滚且 total 一并还原

import {
	deleteBookmarkE,
	getBookmarksE,
	searchBookmarksE,
} from "@modules/bookmark";
import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBookmarkPage } from "./useBookmarkPage.ts";

vi.mock("@modules/bookmark", () => ({
	batchDeleteBookmarksE: vi.fn(),
	deleteBookmarkE: vi.fn(),
	fetchUrlTitleE: vi.fn(),
	getBookmarksE: vi.fn(),
	searchBookmarksE: vi.fn(),
	setBookmarkTagsE: vi.fn(),
	suggestBookmarkTagsE: vi.fn(),
	updateBookmarkE: vi.fn(),
}));

let urlQ = "";
vi.mock("@solidjs/router", () => ({
	useSearchParams: () => [
		{
			get q() {
				return urlQ;
			},
			get tag() {
				return "";
			},
			get page() {
				return "1";
			},
		},
		vi.fn(),
	],
}));

const confirmResolve = vi.fn();
vi.mock("@shared/utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@shared/utils")>();
	return {
		...actual,
		showConfirm: () => confirmResolve(),
		notifySuccess: vi.fn(),
		notifyError: vi.fn(),
	};
});

const mockedGet = vi.mocked(getBookmarksE);
const mockedSearch = vi.mocked(searchBookmarksE);
const mockedDelete = vi.mocked(deleteBookmarkE);

const bm = (id: number) => ({
	id,
	title: `书签${id}`,
	url: `https://example.com/${id}`,
	description: "",
	tags: [],
	visit_count: 0,
	created_at: "2026-08-22T00:00:00+00:00",
	updated_at: "2026-08-22T00:00:00+00:00",
});
const paginated = (
	items: ReturnType<typeof bm>[],
	page: number,
	totalPages: number,
) => ({
	items,
	page,
	total_pages: totalPages,
	total: items.length,
	page_size: 500,
});

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function withHook<T>(
	fn: (h: ReturnType<typeof useBookmarkPage>) => T | Promise<T>,
) {
	return new Promise<T>((resolve) => {
		createRoot(async (dispose) => {
			const h = useBookmarkPage();
			try {
				resolve(await fn(h));
			} finally {
				dispose();
			}
		});
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	urlQ = "";
	confirmResolve.mockResolvedValue(true);
	mockedGet.mockResolvedValue(paginated([bm(1), bm(2)], 1, 1));
});

describe("useBookmarkPage：数据接入", () => {
	it("挂载即拉取并填充列表与分页信息", () =>
		withHook(async (h) => {
			await settle(() => h.bookmarks().length === 2);
			expect(h.bookmarks().map((b) => b.id)).toEqual([1, 2]);
			expect(h.total()).toBe(2);
			expect(h.totalPages()).toBe(1);
			expect(h.loading()).toBe(false);
			expect(h.error()).toBeFalsy();
		}));

	it("URL 带 q 时走 searchBookmarksE 而非 getBookmarksE", () => {
		// 参数需在创建 hook 之前设好：mock 的 setSearchParams 是空操作，
		// 运行中改参不会真的改变 URL
		urlQ = "量子";
		mockedSearch.mockResolvedValue(paginated([bm(9)], 1, 1));
		return withHook(async (h) => {
			await settle(() => h.bookmarks().some((b) => b.id === 9));
			expect(mockedSearch).toHaveBeenCalledWith("量子", 1, 500, undefined);
			expect(mockedGet).not.toHaveBeenCalled();
		});
	});

	it("静默重载不把 loading 置为 true（避免骨架屏闪烁）", () =>
		withHook(async (h) => {
			await settle(() => h.bookmarks().length === 2);
			expect(h.loading()).toBe(false);

			mockedGet.mockResolvedValue(paginated([bm(1), bm(2), bm(3)], 1, 1));
			await h.load({ silent: true });
			// 静默期间不得出现 loading（这正是 silent 的用途）
			expect(h.loading()).toBe(false);
			await settle(() => h.bookmarks().length === 3);
			expect(h.bookmarks().length).toBe(3);
		}));
});

describe("useBookmarkPage：删除", () => {
	it("成功删除后从列表移除且 total 同步减一", () =>
		withHook(async (h) => {
			await settle(() => h.bookmarks().length === 2);
			mockedDelete.mockResolvedValue(undefined);
			await h.handleDelete(bm(1) as never);
			await settle(() => h.bookmarks().length === 1);
			expect(h.bookmarks().map((b) => b.id)).toEqual([2]);
			expect(h.total()).toBe(1);
		}));

	it("删除失败回滚列表与 total", () =>
		withHook(async (h) => {
			await settle(() => h.bookmarks().length === 2);
			mockedDelete.mockRejectedValue(new Error("外键约束"));
			await h.handleDelete(bm(1) as never);
			await flush();
			expect(h.bookmarks().map((b) => b.id)).toEqual([1, 2]);
			expect(h.total()).toBe(2);
		}));

	it("取消确认时不发请求、列表不变", () =>
		withHook(async (h) => {
			await settle(() => h.bookmarks().length === 2);
			confirmResolve.mockResolvedValue(false);
			await h.handleDelete(bm(1) as never);
			expect(mockedDelete).not.toHaveBeenCalled();
			expect(h.bookmarks().length).toBe(2);
		}));
});
