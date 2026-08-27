import { describe, expect, it } from "vitest";
import {
	DEFAULT_STALE_MS,
	DOMAIN_STALE_MS,
	resolveStaleMs,
} from "./domainPatterns.ts";

describe("resolveStaleMs", () => {
	it("tasks 域聚合查询默认 60s（修正倒挂）", () => {
		expect(resolveStaleMs("GET /tasks/tree")).toBe(60_000);
		expect(resolveStaleMs("GET /tasks/stats")).toBe(60_000);
		expect(resolveStaleMs("GET /tasks/5/detail")).toBe(60_000);
		expect(resolveStaleMs("GET /tasks/dag")).toBe(60_000);
	});

	it("onto 域默认 60s（数据不常变）", () => {
		expect(resolveStaleMs("GET /onto")).toBe(60_000);
		expect(resolveStaleMs("GET /onto/5")).toBe(60_000);
	});

	it("cards/media/bookmarks/text/timeWindows/db 默认 30s", () => {
		expect(resolveStaleMs("GET /cards")).toBe(30_000);
		expect(resolveStaleMs("GET /media/5")).toBe(30_000);
		expect(resolveStaleMs("GET /bookmarks?page=1")).toBe(30_000);
		expect(resolveStaleMs("GET /text")).toBe(30_000);
		expect(resolveStaleMs("GET /time-windows?task_id=5")).toBe(30_000);
		expect(resolveStaleMs("GET /db")).toBe(30_000);
	});

	it("未匹配域的路径回退 DEFAULT_STALE_MS", () => {
		expect(resolveStaleMs("GET /unknown/path")).toBe(DEFAULT_STALE_MS);
	});

	it("显式 staleMs 优先于域默认", () => {
		expect(resolveStaleMs("GET /tasks/tree", 15_000)).toBe(15_000);
		expect(resolveStaleMs("GET /cards", 999)).toBe(999);
		expect(resolveStaleMs("GET /cards", 0)).toBe(0);
	});

	it("DOMAIN_STALE_MS 只声明了 tasks 和 onto", () => {
		expect(DOMAIN_STALE_MS).toEqual({ tasks: 60_000, onto: 60_000 });
	});
});
