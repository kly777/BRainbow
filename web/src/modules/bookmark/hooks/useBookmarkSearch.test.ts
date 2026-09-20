// ── useBookmarkSearch 契约测试 ──
// 最要紧的一条是"不闪烁"：搜索中必须保留上一次的结果（页面只在首次搜索给加载态，
// 更新过程只用「更新中…」提示）。这条契约原先靠页面里手写的 4 个信号 + searchSeq
// 守卫维持，换成资源驱动后由这组断言钉住，防它回潮。

import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchBookmarksE } from "../api.ts";
import { useBookmarkSearch } from "./useBookmarkSearch.ts";

vi.mock("../api.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../api.ts")>();
	return { ...actual, searchBookmarksE: vi.fn() };
});

const mockedSearch = vi.mocked(searchBookmarksE);

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

const page = (...titles: string[]) =>
	({
		items: titles.map((title, i) => ({ id: i + 1, title })),
		page: 1,
		total: titles.length,
		total_pages: 1,
	}) as never;

function setup() {
	let api!: ReturnType<typeof useBookmarkSearch>;
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => {
		api = useBookmarkSearch();
		return null;
	}, host);
	return api;
}

beforeEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = "";
});

describe("useBookmarkSearch", () => {
	it("没有查询词时不发请求，且结果为空（页面据此回到分组视图）", () => {
		const api = setup();
		expect(api.query()).toBe("");
		expect(api.results()).toBeNull();
		expect(api.updating()).toBe(false);
		expect(api.error()).toBeNull();
		expect(mockedSearch).not.toHaveBeenCalled();
	});

	it("输入后取数并给出结果", async () => {
		mockedSearch.mockResolvedValue(page("第一篇"));
		const api = setup();
		api.setQuery("第一");
		await settle(() => (api.results()?.length ?? 0) > 0);

		expect(mockedSearch).toHaveBeenCalledWith("第一", 1, 200);
		expect(api.results()?.[0]?.title).toBe("第一篇");
	});

	it("搜索中保留上一次结果（不闪烁），只标记「更新中」", async () => {
		mockedSearch.mockResolvedValueOnce(page("第一篇"));
		const api = setup();
		api.setQuery("第一");
		await settle(() => (api.results()?.length ?? 0) > 0);

		// 第二次请求悬而不决：此时旧结果必须还在
		mockedSearch.mockReturnValue(new Promise(() => {}) as never);
		api.setQuery("第二");
		await settle(() => api.updating());

		expect(api.updating()).toBe(true);
		expect(api.results()?.[0]?.title).toBe("第一篇");
		expect(api.error()).toBeNull();
	});

	it("清空查询词回到分组视图（结果置空）", async () => {
		mockedSearch.mockResolvedValue(page("第一篇"));
		const api = setup();
		api.setQuery("第一");
		await settle(() => (api.results()?.length ?? 0) > 0);

		api.setQuery("");
		expect(api.results()).toBeNull();
		expect(api.updating()).toBe(false);
	});

	it("失败时给出文案（不把异常抛给页面）", async () => {
		mockedSearch.mockRejectedValue(new Error("网络断了"));
		const api = setup();
		api.setQuery("任意");
		await settle(() => api.error() !== null);

		expect(api.error()).toContain("网络断了");
		expect(api.results()).toBeNull();
	});
});
