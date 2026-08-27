import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCacheKey, cachedRequest, clearAllCache } from "./cache.ts";
import { CACHE, domains } from "./domains.ts";
import { request } from "./request.ts";

vi.mock("./request.ts", () => ({ request: vi.fn() }));
const mockedRequest = vi.mocked(request);

afterEach(() => {
	clearAllCache();
	vi.restoreAllMocks();
});

// ── CACHE 正则边界（自 domains.ts 声明，写入方不再直接接触） ──

describe("CACHE 预定义正则边界", () => {
	// 每个域：[正则, 本域真实端点样例（含子路径与查询串）, 真正易混淆的他域端点]。
	// 注意：前缀命中子路径（/cards 命中 /cards/9）是失效语义的预期行为，
	// 这里只验证不会越界到"同域易混淆"的端点。
	const cases: [RegExp, string, string[]][] = [
		[CACHE.cards, "/cards?page=1&size=20", ["/card/5"]],
		[CACHE.bookmarks, "/bookmarks?tag=3", []],
		[CACHE.tasks, "/tasks/5/children", ["/time-windows"]],
		[CACHE.timeWindows, "/time-windows?from=1", ["/text/1"]],
		[CACHE.text, "/text/42", ["/time-windows"]],
		[CACHE.media, "/media/7/file", ["/mem/due"]],
		[CACHE.onto, "/onto/tree/3", []],
		[CACHE.db, "/db/tables", []],
	];

	it.each(cases)("%# 命中本域、不越界到易混淆端点", (re, own, foreign) => {
		expect(re.test(buildCacheKey("GET", own))).toBe(true);
		for (const f of foreign) {
			expect(re.test(buildCacheKey("GET", f))).toBe(false);
		}
	});

	it("已修剪死域：mem/sign 不再出现在注册表中", () => {
		expect("mem" in domains).toBe(false);
		expect("sign" in domains).toBe(false);
	});
});

// ── domains 注册表：写→失效 配对穿过公开接缝 ──

describe("domains 写→失效配对", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearAllCache();
	});

	it("写入后本域读取必重取", async () => {
		mockedRequest.mockResolvedValue([{ id: 1 }]);
		await cachedRequest("/cards?page=1"); // 预热
		expect(mockedRequest).toHaveBeenCalledTimes(1);

		await domains.cards.invalidate(Promise.resolve({ ok: true }));
		await cachedRequest("/cards?page=1"); // 应重取
		expect(mockedRequest).toHaveBeenCalledTimes(2);
	});

	it("tasks 写入连带失效 timeWindows 读取（跨域）", async () => {
		mockedRequest.mockResolvedValue([{ id: 1 }]);
		await cachedRequest("/time-windows?task_id=1"); // 预热
		expect(mockedRequest).toHaveBeenCalledTimes(1);

		await domains.tasks.invalidate(Promise.resolve({ ok: true }));
		await cachedRequest("/time-windows?task_id=1"); // 应重取
		expect(mockedRequest).toHaveBeenCalledTimes(2);
	});

	it("timeWindows 写入不连坐 tasks（无环回）", async () => {
		mockedRequest.mockResolvedValue([{ id: 1 }]);
		await cachedRequest("/tasks"); // 预热
		expect(mockedRequest).toHaveBeenCalledTimes(1);

		await domains.timeWindows.invalidate(Promise.resolve({ ok: true }));
		await cachedRequest("/tasks"); // 应命中缓存
		expect(mockedRequest).toHaveBeenCalledTimes(1);
	});

	it("失效只清本域，他域缓存保留", async () => {
		mockedRequest.mockResolvedValue([{ id: 1 }]);
		await cachedRequest("/cards"); // 第 1 次
		await cachedRequest("/tasks"); // 第 2 次
		expect(mockedRequest).toHaveBeenCalledTimes(2);

		await domains.cards.invalidate(Promise.resolve({ ok: true }));
		await cachedRequest("/cards"); // 重取 → 第 3 次
		await cachedRequest("/tasks"); // 命中缓存，无新请求
		expect(mockedRequest).toHaveBeenCalledTimes(3);
	});

	it("失效在写入成功后发生，写入失败时不失效", async () => {
		mockedRequest.mockResolvedValue([{ id: 1 }]);
		await cachedRequest("/cards"); // 预热
		expect(mockedRequest).toHaveBeenCalledTimes(1);

		// 写入失败 → 不应失效缓存
		await expect(
			domains.cards.invalidate(Promise.reject(new Error("boom"))),
		).rejects.toThrow("boom");
		await cachedRequest("/cards"); // 仍命中
		expect(mockedRequest).toHaveBeenCalledTimes(1);
	});
});

describe("分级失效（reads vs singles + entity）", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearAllCache();
	});

	it("无 entity 的写入连坐清列表/搜索，但不动单条", async () => {
		mockedRequest.mockResolvedValue("data");
		await cachedRequest("/cards"); // 列表
		await cachedRequest("/cards/5"); // 单条
		await cachedRequest("/cards/search?q=x"); // 搜索
		expect(mockedRequest).toHaveBeenCalledTimes(3);

		await domains.cards.invalidate(Promise.resolve({ ok: true })); // 无 entity

		// 列表和搜索被连坐清
		await cachedRequest("/cards");
		expect(mockedRequest).toHaveBeenCalledTimes(4); // 重取
		await cachedRequest("/cards/search?q=x");
		expect(mockedRequest).toHaveBeenCalledTimes(5); // 重取

		// 单条未被清
		await cachedRequest("/cards/5");
		expect(mockedRequest).toHaveBeenCalledTimes(5); // 命中缓存
	});

	it("有 entity 的写入精确清单条，他域单条不受影响", async () => {
		mockedRequest.mockResolvedValue("data");
		await cachedRequest("/cards"); // 列表
		await cachedRequest("/cards/5"); // 单条（被写实体）
		await cachedRequest("/cards/7"); // 单条（他域实体）
		expect(mockedRequest).toHaveBeenCalledTimes(3);

		await domains.cards.invalidate(
			Promise.resolve({ ok: true }),
			{ entity: "/cards/5" }, // 只写实体 5
		);

		// 列表被连坐清
		await cachedRequest("/cards");
		expect(mockedRequest).toHaveBeenCalledTimes(4);

		// 被写实体精确清
		await cachedRequest("/cards/5");
		expect(mockedRequest).toHaveBeenCalledTimes(5); // 重取

		// 他域单条不受影响
		await cachedRequest("/cards/7");
		expect(mockedRequest).toHaveBeenCalledTimes(5); // 命中缓存
	});

	it("tasks 写入连带失效 timeWindows 广域（跨域），不影响 timeWindows 单条", async () => {
		mockedRequest.mockResolvedValue("tw");
		await cachedRequest("/time-windows?task_id=1"); // 广域（列表）
		expect(mockedRequest).toHaveBeenCalledTimes(1);

		await domains.tasks.invalidate(Promise.resolve({ ok: true }));

		// timeWindows 广域被跨域连坐
		await cachedRequest("/time-windows?task_id=1");
		expect(mockedRequest).toHaveBeenCalledTimes(2); // 重取
	});
});
