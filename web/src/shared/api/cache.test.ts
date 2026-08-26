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

// ── cachedRequest：读穿缓存（单一飞行 + 陈旧重验证） ──

import { cachedRequest } from "./cache.ts";
import { request } from "./request.ts";

vi.mock("./request.ts", () => ({ request: vi.fn() }));
const mockedRequest = vi.mocked(request);

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

	it("并发相同 key 合并为一次网络请求，所有调用共享同一结果", async () => {
		let resolve!: (v: { id: number }) => void;
		mockedRequest.mockReturnValue(
			new Promise<{ id: number }>((r) => {
				resolve = r;
			}),
		);
		const p1 = cachedRequest<{ id: number }>("/cards/5");
		const p2 = cachedRequest<{ id: number }>("/cards/5");
		expect(mockedRequest).toHaveBeenCalledTimes(1); // 单一飞行
		resolve({ id: 5 });
		await expect(p1).resolves.toEqual({ id: 5 });
		await expect(p2).resolves.toEqual({ id: 5 });
		expect(mockedRequest).toHaveBeenCalledTimes(1);
	});

	it("过期条目先回旧值，后台刷新后新值可见", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		let refreshResolve!: (v: { items: string[] }) => void;
		mockedRequest.mockResolvedValueOnce({ items: ["old"] }).mockReturnValueOnce(
			new Promise<{ items: string[] }>((r) => {
				refreshResolve = r;
			}),
		);

		await cachedRequest<{ items: string[] }>("/cards"); // 预热
		expect(mockedRequest).toHaveBeenCalledTimes(1);

		vi.setSystemTime(new Date("2026-01-01T00:00:31Z")); // 过期
		const stale = await cachedRequest<{ items: string[] }>("/cards");
		expect(stale).toEqual({ items: ["old"] }); // 立即回旧值，不等待
		expect(mockedRequest).toHaveBeenCalledTimes(2); // 后台刷新已发起

		refreshResolve({ items: ["new"] });
		await Promise.resolve();
		await Promise.resolve(); // 冲刷 writeCache 微任务

		const fresh = await cachedRequest<{ items: string[] }>("/cards");
		expect(fresh).toEqual({ items: ["new"] });
	});

	it("后台刷新失败不抛出，旧值保留，下次读取再试", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		mockedRequest
			.mockResolvedValueOnce({ ok: true })
			.mockRejectedValueOnce(new Error("boom"));

		await cachedRequest("/cards"); // 预热
		vi.setSystemTime(new Date("2026-01-01T00:00:31Z"));

		await expect(cachedRequest("/cards")).resolves.toEqual({ ok: true });
		await Promise.resolve();
		await Promise.resolve(); // 冲刷失败链
		expect(mockedRequest).toHaveBeenCalledTimes(2);

		// 旧值仍在，可继续陈旧读取
		await expect(cachedRequest("/cards")).resolves.toEqual({ ok: true });
	});
});
