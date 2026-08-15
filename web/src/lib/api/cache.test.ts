import { afterEach, describe, expect, it, vi } from "vitest";
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
