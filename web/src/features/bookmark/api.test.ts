import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const requestMock = vi.hoisted(() => ({
	request: vi.fn(),
	post: vi.fn(),
	patch: vi.fn(),
	del: vi.fn(),
}));

const cacheMock = vi.hoisted(() => ({
	CACHE: { bookmarks: /^GET \/bookmarks/ },
	cachedRequest: vi.fn(),
	invalidateCache: vi.fn(),
	tapInvalidate: vi.fn((_p: RegExp, r: unknown) => r),
}));

vi.mock("@apis/request.ts", () => requestMock);
vi.mock("@apis/cache.ts", () => cacheMock);

import {
	createBookmarkE,
	deleteBookmarkE,
	deleteBookmarkTagE,
	getBookmarksE,
	importBookmarksE,
	searchBookmarkTagsE,
	searchBookmarksE,
	setBookmarkTagsE,
	updateBookmarkE,
} from "./api";

beforeEach(() => {
	vi.clearAllMocks();
	cacheMock.cachedRequest.mockImplementation((url: string) => Promise.resolve({ url }));
	requestMock.post.mockImplementation((_u: string, b: unknown) => Promise.resolve(b));
	requestMock.patch.mockImplementation((_u: string, b: unknown) => Promise.resolve(b));
	requestMock.del.mockImplementation(() => Promise.resolve());
	requestMock.request.mockImplementation((_u: string, o: unknown) => Promise.resolve(o));
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ── 查询 URL 构造 ──

describe("getBookmarksE", () => {
	it("builds URL with page and page_size", async () => {
		await getBookmarksE(2, 50);
		const url = cacheMock.cachedRequest.mock.calls[0][0] as string;
		expect(url).toContain("/bookmarks?");
		expect(url).toContain("page=2");
		expect(url).toContain("page_size=50");
	});

	it("omits tag param when absent", async () => {
		await getBookmarksE(1, 20);
		const url = cacheMock.cachedRequest.mock.calls[0][0] as string;
		expect(url).not.toContain("tag=");
	});

	it("includes tag param when provided", async () => {
		await getBookmarksE(1, 20, "学习");
		const url = cacheMock.cachedRequest.mock.calls[0][0] as string;
		expect(url).toContain(`tag=${encodeURIComponent("学习")}`);
	});
});

describe("searchBookmarksE", () => {
	it("builds search URL with q/page/page_size", async () => {
		await searchBookmarksE("rust 教程", 3, 10);
		const url = cacheMock.cachedRequest.mock.calls[0][0] as string;
		expect(url).toContain("/bookmarks/search?");
		expect(url).toContain("q=rust+%E6%95%99%E7%A8%8B");
		expect(url).toContain("page=3");
		expect(url).toContain("page_size=10");
	});

	it("includes tag only when provided", async () => {
		await searchBookmarksE("x", 1, 20, "a&b");
		const url = cacheMock.cachedRequest.mock.calls[0][0] as string;
		expect(url).toContain(`tag=${encodeURIComponent("a&b")}`);
	});
});

describe("searchBookmarkTagsE", () => {
	it("uses bare path when query empty or whitespace", async () => {
		await searchBookmarkTagsE("");
		expect(cacheMock.cachedRequest.mock.calls[0][0]).toBe("/bookmarks/tags");

		await searchBookmarkTagsE("   ");
		expect(cacheMock.cachedRequest.mock.calls[1][0]).toBe("/bookmarks/tags");
	});

	it("encodes query param", async () => {
		await searchBookmarkTagsE(" 前端 2.0 ");
		const url = cacheMock.cachedRequest.mock.calls[0][0] as string;
		expect(url).toContain(`q=${encodeURIComponent("前端 2.0")}`);
	});
});

// ── 写操作与缓存失效 ──

describe("write operations invalidate cache", () => {
	const bm = { id: 1, title: "t", url: "https://example.com" };

	it("create posts and invalidates", async () => {
		await createBookmarkE(bm);
		expect(requestMock.post).toHaveBeenCalledWith("/bookmarks", bm);
		expect(cacheMock.tapInvalidate).toHaveBeenCalledWith(cacheMock.CACHE.bookmarks, bm);
	});

	it("update patches and invalidates", async () => {
		await updateBookmarkE(1, { title: "new" });
		expect(requestMock.patch).toHaveBeenCalledWith("/bookmarks/1", { title: "new" });
		expect(cacheMock.tapInvalidate).toHaveBeenCalledWith(cacheMock.CACHE.bookmarks, { title: "new" });
	});

	it("delete removes and invalidates", async () => {
		await deleteBookmarkE(7);
		expect(requestMock.del).toHaveBeenCalledWith("/bookmarks/7");
		expect(cacheMock.tapInvalidate).toHaveBeenCalled();
	});

	it("setTags PUTs tag list and invalidates", async () => {
		await setBookmarkTagsE(1, ["a", "b"]);
		expect(requestMock.request).toHaveBeenCalledWith("/bookmarks/1/tags", {
			method: "PUT",
			body: JSON.stringify({ tags: ["a", "b"] }),
		});
		expect(cacheMock.tapInvalidate).toHaveBeenCalledWith(
			cacheMock.CACHE.bookmarks,
			expect.anything(),
		);
	});

	it("deleteTag removes and invalidates", async () => {
		await deleteBookmarkTagE(3);
		expect(requestMock.del).toHaveBeenCalledWith("/bookmarks/tags/3");
		expect(cacheMock.tapInvalidate).toHaveBeenCalled();
	});
});

// ── 导入 ──

describe("importBookmarksE", () => {
	it("sends multipart form and invalidates on success", async () => {
		requestMock.request.mockImplementationOnce(() => Promise.resolve({ added: 5, merged: 2 }));
		const file = new File(["<html>"], "bookmarks.html", { type: "text/html" });
		const result = await importBookmarksE(file);
		expect(result).toEqual({ added: 5, merged: 2 });

		const [url, opts] = requestMock.request.mock.calls[0];
		expect(url).toBe("/bookmarks/import");
		expect(opts.method).toBe("POST");
		expect(opts.body).toBeInstanceOf(FormData);
		expect((opts.body as FormData).get("file")).toBe(file);
		expect(cacheMock.invalidateCache).toHaveBeenCalledWith(cacheMock.CACHE.bookmarks);
	});
});
