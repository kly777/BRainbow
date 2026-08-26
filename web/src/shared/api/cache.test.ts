import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildCacheKey,
	cacheSize,
	clearAllCache,
	invalidateCache,
	readCache,
	writeCache,
} from "./cache.ts";

afterEach(() => {
	clearAllCache();
	vi.useRealTimers();
});

describe("cache", () => {
	it("buildCacheKey 统一方法与路径", () => {
		expect(buildCacheKey("get", "/cards")).toBe("GET /cards");
		expect(buildCacheKey("DELETE", "/cards/1")).toBe("DELETE /cards/1");
	});

	it("写入后可读取，超过 TTL 后读取会删除过期条目", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

		writeCache("GET /cards", { a: 1 });
		expect(readCache<{ a: number }>("GET /cards")).toEqual({ a: 1 });

		vi.setSystemTime(new Date("2026-01-01T00:00:31Z"));
		expect(readCache("GET /cards")).toBeNull();
		expect(cacheSize()).toBe(0);
	});

	it("invalidateCache 按正则批量失效", () => {
		writeCache("GET /cards", 1);
		writeCache("GET /cards/1", 2);
		writeCache("GET /tasks", 3);

		invalidateCache(/^GET \/cards/);

		expect(readCache("GET /cards")).toBeNull();
		expect(readCache("GET /cards/1")).toBeNull();
		expect(readCache("GET /tasks")).toBe(3);
	});

	it("clearAllCache 清空全部", () => {
		writeCache("GET /a", 1);
		writeCache("GET /b", 2);
		clearAllCache();
		expect(cacheSize()).toBe(0);
	});

	it("超过 200 条时按插入顺序淘汰最旧条目", () => {
		for (let i = 0; i < 210; i++) {
			writeCache(`GET /page/${i}`, i);
		}

		expect(cacheSize()).toBe(200);
		// 最早的 10 个 key 被淘汰，第 10 个仍是最旧的存活项
		expect(readCache("GET /page/0")).toBeNull();
		expect(readCache("GET /page/9")).toBeNull();
		expect(readCache("GET /page/10")).toBe(10);
		expect(readCache("GET /page/209")).toBe(209);
	});
});

// ── CACHE 正则边界与写路径配对（测试覆盖扩充）──

import { CACHE, cachedRequest } from "./cache.ts";
import { request } from "./request.ts";

vi.mock("./request.ts", () => ({ request: vi.fn() }));
const mockedRequest = vi.mocked(request);

// 每个域：[正则, 本域真实端点样例（含子路径与查询串）, 真正易混淆的他域端点]。
// 注意：前缀命中子路径（/cards 命中 /cards/9）是失效语义的预期行为，
// 这里只验证不会越界到"同域易混淆"的端点。
describe("CACHE 预定义正则边界", () => {
	const cases: [RegExp, string, string[]][] = [
		[CACHE.cards, "/cards?page=1&size=20", ["/card/5"]],
		[CACHE.bookmarks, "/bookmarks?tag=3", []],
		[CACHE.tasks, "/tasks/5/children", ["/time-windows"]],
		[CACHE.timeWindows, "/time-windows?from=1", ["/text/1"]],
		[CACHE.text, "/text/42", ["/time-windows"]],
		[CACHE.media, "/media/7/file", ["/mem/due"]],
		[CACHE.mem, "/mem/due?limit=10", ["/media/list"]],
		[CACHE.onto, "/onto/tree/3", []],
		[CACHE.sign, "/sign/pairs?tag=1", ["/search?q=x"]],
		[CACHE.db, "/db/tables", []],
	];

	it.each(cases)("%# 命中本域、不越界到易混淆端点", (re, own, foreign) => {
		expect(re.test(buildCacheKey("GET", own))).toBe(true);
		for (const f of foreign) {
			expect(re.test(buildCacheKey("GET", f))).toBe(false);
		}
	});

	it("失效正则只清本域，他域缓存保留", () => {
		writeCache(buildCacheKey("GET", "/cards"), [{ id: 1 }]);
		writeCache(buildCacheKey("GET", "/mem/due"), []);
		invalidateCache(CACHE.cards);
		expect(readCache(buildCacheKey("GET", "/cards"))).toBeNull();
		expect(readCache(buildCacheKey("GET", "/mem/due"))).toEqual([]);
	});
});

describe("cachedRequest", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearAllCache();
	});

	it("GET 命中缓存时第二次不再发请求", async () => {
		mockedRequest.mockResolvedValue({ items: [1] });
		const first = await cachedRequest<{ items: number[] }>("/cards");
		const second = await cachedRequest<{ items: number[] }>("/cards");
		expect(first).toEqual({ items: [1] });
		expect(second).toEqual({ items: [1] });
		expect(mockedRequest).toHaveBeenCalledTimes(1);
	});

	it("非 GET 直接透传且不写缓存", async () => {
		mockedRequest.mockResolvedValue({ ok: true });
		const out = await cachedRequest("/cards", { method: "POST" });
		expect(out).toEqual({ ok: true });
		expect(mockedRequest).toHaveBeenCalledTimes(1);
		expect(cacheSize()).toBe(0); // 写操作不进缓存
	});

	it("不同端点各自缓存互不干扰", async () => {
		mockedRequest.mockResolvedValueOnce("A").mockResolvedValueOnce("B");
		expect(await cachedRequest("/cards")).toBe("A");
		expect(await cachedRequest("/mem/due")).toBe("B");
		expect(await cachedRequest("/cards")).toBe("A"); // 仍命中第一次的缓存
		expect(mockedRequest).toHaveBeenCalledTimes(2);
	});
});
