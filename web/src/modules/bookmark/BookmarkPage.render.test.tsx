// ── BookmarkPage 渲染测试 ──
// 这个页面刚把搜索态从"页面自持 4 个信号 + searchSeq 竞态守卫"换成
// useBookmarkSearch（资源驱动）。断言锁住两种模式的切换与分组视图的两处既有规则：
// 只有 >2 个书签的分组才展开、未分类单独一组。

import { SEARCH_DEBOUNCE_MS } from "@shared/utils";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BookmarkPage from "./BookmarkPage.tsx";

vi.mock("./api.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./api.ts")>();
	return {
		...actual,
		getGroupedBookmarksE: vi.fn(),
		searchBookmarksE: vi.fn(),
		incrementBookmarkVisitE: vi.fn(),
	};
});

vi.mock("@solidjs/router", () => ({
	A: (props: { children?: unknown; href?: string }) => (
		<a href={props.href}>{props.children as never}</a>
	),
	useNavigate: () => vi.fn(),
	useParams: () => ({}),
}));

const { getGroupedBookmarksE, searchBookmarksE } = await import("./api.ts");
const mockedGrouped = vi.mocked(getGroupedBookmarksE);
const mockedSearch = vi.mocked(searchBookmarksE);

const bm = (id: number, title: string) => ({
	id,
	title,
	url: `https://example.com/${id}`,
	visit_count: 0,
	created_at: "2026-09-01T10:00:00+00:00",
	updated_at: "2026-09-01T10:00:00+00:00",
});

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}
/** SearchInput 内置防抖：等它真的把值交出去 */
const waitDebounce = () =>
	new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 50));

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <BookmarkPage />, host);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedGrouped.mockResolvedValue({
		groups: [
			{
				tag: "工作",
				total_visits: 7,
				bookmarks: [bm(1, "甲"), bm(2, "乙"), bm(3, "丙")],
			},
			{ tag: "零散", total_visits: 1, bookmarks: [bm(4, "独苗")] },
		],
		untagged: [bm(5, "未分类的一条")],
	} as never);
	mockedSearch.mockResolvedValue({
		items: [bm(9, "搜索命中")],
		page: 1,
		total: 1,
		total_pages: 1,
	} as never);
});

describe("BookmarkPage", () => {
	it("分组视图：展开超过两条的分组，未分类单独一组", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("工作"));

		expect(host.textContent).toContain("#工作");
		expect(host.textContent).toContain("3 个书签");
		expect(host.textContent).toContain("未分类");
		// 只有一条的分组不展开（既有规则：避免一屏全是单条分组）
		expect(host.textContent).not.toContain("零散");
		expect(host.textContent).not.toContain("独苗");
	});

	it("输入关键词切到搜索模式（走 useBookmarkSearch）", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("工作"));

		const input = host.querySelector(
			"input[type='search']",
		) as HTMLInputElement;
		input.value = "命中";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await waitDebounce();
		await settle(() => (host.textContent ?? "").includes("搜索命中"));

		expect(mockedSearch).toHaveBeenCalledWith("命中", 1, 200);
		expect(host.textContent).toContain("搜索结果：1 条");
		expect(host.textContent).toContain("搜索命中");
		expect(host.textContent).not.toContain("#工作");
	});

	it("清空搜索回到分组视图", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("工作"));

		const input = host.querySelector(
			"input[type='search']",
		) as HTMLInputElement;
		input.value = "命中";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await waitDebounce();
		await settle(() => (host.textContent ?? "").includes("搜索结果"));

		// 清空按钮由 query 非空时出现
		const clear = Array.from(host.querySelectorAll("button")).find((b) =>
			b.getAttribute("title")?.includes("清空搜索"),
		) as HTMLButtonElement;
		clear.click();
		await settle(() => (host.textContent ?? "").includes("#工作"));

		expect(host.textContent).toContain("#工作");
		expect(host.textContent).not.toContain("搜索结果：");
	});
});
