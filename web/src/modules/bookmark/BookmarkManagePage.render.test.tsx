// ── BookmarkManagePage 渲染回归 ──
// 本页刚从"PageHead + 三个独立 <Show> 做四态"迁到 ListPage 外壳（四态交给
// AsyncView）。这组断言锁住迁移后必须仍成立的行为。
//
// 一处已知的可见变化：加载态从 `LoadingSkeleton` 换成 AsyncView 自带的骨架
// —— 这是刻意的，为与其他 5 个列表页一致。

import { getBookmarksE, searchBookmarksE } from "@modules/bookmark";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BookmarkPage from "./BookmarkManagePage.tsx";

// mock barrel（hook 与各组件都从这里导入）；用 importOriginal 保留非 API 导出
vi.mock("@modules/bookmark/api.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@modules/bookmark/api.ts")>();
	const fn = () => vi.fn();
	return {
		...actual,
		getBookmarksE: fn(),
		searchBookmarksE: fn(),
		getBookmarkE: fn(),
		createBookmarkE: fn(),
		updateBookmarkE: fn(),
		deleteBookmarkE: fn(),
		batchDeleteBookmarksE: fn(),
		setBookmarkTagsE: fn(),
		suggestBookmarkTagsE: fn(),
		deleteBookmarkTagE: fn(),
		searchBookmarkTagsE: fn(),
		fetchUrlTitleE: fn(),
		checkBookmarkUrlE: fn(),
		importBookmarksE: fn(),
	};
});

let urlQ = "";
vi.mock("@solidjs/router", () => ({
	useNavigate: () => vi.fn(),
	useParams: () => ({}),
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

const bm = (id: number, title: string) => ({
	id,
	title,
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

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <BookmarkPage />, host);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
	urlQ = "";
	confirmResolve.mockResolvedValue(true);
	mockedGet.mockResolvedValue(
		paginated([bm(1, "书签甲"), bm(2, "书签乙")], 1, 1),
	);
});

describe("BookmarkManagePage：外壳迁移后的回归", () => {
	it("渲染唯一的 h1，内容为页面标题", async () => {
		const host = mount();
		await flush();
		const h1 = host.querySelectorAll("h1");
		expect(h1.length).toBe(1);
		expect(h1[0].textContent).toBe("网页书签");
	});

	it("加载完成后渲染书签条目与全选行", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("书签甲"));
		expect(host.textContent).toContain("书签甲");
		expect(host.textContent).toContain("书签乙");
		expect(host.textContent).toContain("全选");
	});

	it("空列表显示空态文案（非搜索态）", async () => {
		mockedGet.mockResolvedValue(paginated([], 1, 0));
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("还没有书签"));
		expect(host.textContent).toContain("还没有书签");
	});

	it("搜索态下空结果给出不同文案", async () => {
		urlQ = "查无此书";
		mockedSearch.mockResolvedValue(paginated([], 1, 0));
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("没有找到匹配的书签"));
		expect(host.textContent).toContain("没有找到匹配的书签");
	});

	it("加载失败显示错误态与重试入口（不再卡在骨架屏）", async () => {
		mockedGet.mockRejectedValue(new Error("书签接口不可用"));
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("书签接口不可用"));
		expect(host.textContent).toContain("书签接口不可用");
		expect(host.querySelector("button")).toBeTruthy();
		expect(host.querySelector('[class*="skeletonListWrap"]')).toBeNull();
	});

	it("页头动作区仍渲染导入/标签管理/新建按钮", async () => {
		const host = mount();
		await flush();
		expect(host.textContent).toContain("导入");
		expect(host.textContent).toContain("标签管理");
		expect(host.textContent).toContain("新建书签");
	});
});
