import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
	DEFAULT_STALE_MS,
	DOMAIN_POLICIES,
	type DomainName,
	domainOf,
	resolveStaleMs,
} from "./domainPolicies.ts";

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

	it("cards/bookmarks/text/timeWindows/db 默认 30s", () => {
		expect(resolveStaleMs("GET /cards")).toBe(30_000);
		expect(resolveStaleMs("GET /bookmarks?page=1")).toBe(30_000);
		expect(resolveStaleMs("GET /text")).toBe(30_000);
		expect(resolveStaleMs("GET /tasks/1/blocks")).toBe(30_000);
		expect(resolveStaleMs("GET /db")).toBe(30_000);
		expect(resolveStaleMs("GET /file/stats")).toBe(30_000);
	});

	it("未匹配域的路径回退 DEFAULT_STALE_MS", () => {
		expect(resolveStaleMs("GET /unknown/path")).toBe(DEFAULT_STALE_MS);
		expect(domainOf("GET /unknown/path")).toBeNull();
	});

	it("显式 staleMs 优先于域默认", () => {
		expect(resolveStaleMs("GET /tasks/tree", 15_000)).toBe(15_000);
		expect(resolveStaleMs("GET /cards", 999)).toBe(999);
		expect(resolveStaleMs("GET /cards", 0)).toBe(0);
	});
});

// ── 域归属边界：每个真实端点归本域，且不吞邻域端点 ──

/** 各域真实读端点（含查询串与子路径；改/加端点时这里跟着变） */
const OWN_ENDPOINTS: Record<DomainName, readonly string[]> = {
	cards: ["/cards?page=1", "/cards/search?q=x", "/cards/5"],
	bookmarks: [
		"/bookmarks?page=1",
		"/bookmarks/5",
		"/bookmarks/search?q=x",
		"/bookmarks/tags?q=x",
		"/bookmarks/grouped-by-tag",
		"/bookmarks/check-url?url=https%3A%2F%2Fx.dev",
	],
	tasks: [
		"/tasks",
		"/tasks/all",
		"/tasks/tree",
		"/tasks/stats",
		"/tasks/status/archived",
		"/tasks/user/3",
		"/tasks/search?q=x",
		"/tasks/dag?task_id=1",
		"/tasks/calendar?start=1&end=2",
		"/tasks/5/detail",
		"/tags?prefix=%E5%B7%A5",
	],
	db: ["/db", "/db/tables?page=1", "/db/tables/backrefs?id=1"],
	onto: ["/onto", "/onto/5"],
	text: ["/text"],
	timeWindows: ["/tasks/1/blocks", "/tasks/blocks/5"],
	files: ["/file?page=1", "/file/stats", "/file/tags", "/file/abc123"],
};

describe("域归属", () => {
	it.each(Object.entries(OWN_ENDPOINTS))(
		"%s 的端点都归属本域",
		(domain, endpoints) => {
			for (const endpoint of endpoints) {
				expect(domainOf(`GET ${endpoint}`)).toBe(domain);
			}
		},
	);

	it("不吞邻域与不存在的端点", () => {
		// 易混淆：单数路径、无缓存的域、早年错正则的 /files、幽灵域 media
		expect(domainOf("GET /card/5")).toBeNull();
		expect(domainOf("GET /mem/due")).toBeNull();
		expect(domainOf("GET /files")).toBeNull();
		expect(domainOf("GET /media/5")).toBeNull();
	});

	it("已删的幽灵域不再出现（media 无任何端点）", () => {
		expect("media" in DOMAIN_POLICIES).toBe(false);
	});
});

// ── 与调用点的镜像：每个 cachedRequest 端点都要有域归属 ──

/** 递归收集 web/src 下的非测试源文件路径 */
function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...sourceFiles(path));
		} else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
			out.push(path);
		}
	}
	return out;
}

/**
 * 取所有 `cachedRequest("端点" | `端点`)` 的字面量部分。
 * 模板串在第一个 `${` 处截断，这里按 `?` 生成两种补全（`/tasks/${id}/detail` → `1`，
 * `/file${buildQuery()}` → 空，后者返回的是查询串），只要有一种能定域即视为已登记。
 */
function cachedEndpointKeys(): string[] {
	const root = [
		resolve(process.cwd(), "src"),
		resolve(process.cwd(), "web/src"),
	].find(existsSync);
	if (!root) throw new Error(`找不到 web/src（cwd=${process.cwd()}）`);
	const keys: string[] = [];
	for (const file of sourceFiles(root)) {
		const source = readFileSync(file, "utf8");
		for (const [, , literal] of source.matchAll(
			/cachedRequest(?:<[\s\S]*?>)?\(\s*(["'`])([^"'`]*)\1/g,
		)) {
			const raw = literal ?? "";
			// 模板里的 `${taskId}` / `${buildQuery(...)}` 这类动态段按 1 代入。
			// 如果动态段是**尾部的查询串**（`/tasks/all${buildQuery(...)}`），
			// 代入的 1 要去掉，否则 `/tasks/all1` 这种假端点会误报。
			let resolved = raw.replace(/\$\{[^}]*\}/g, "1").replace(/[)}]+$/, "");
			const lastDynamic = raw.lastIndexOf("${");
			if (
				lastDynamic > 0 &&
				raw.endsWith("}") &&
				raw[lastDynamic - 1] !== "/"
			) {
				resolved = resolved.replace(/1$/, "");
			}
			keys.push(`GET ${resolved}`);
		}
	}
	return keys;
}

describe("调用点镜像", () => {
	const keys = cachedEndpointKeys();

	it("扫到的端点数量合理（防正则失效后空转通过）", () => {
		expect(keys.length).toBeGreaterThan(20);
	});

	it("每个 cachedRequest 端点都能定域（新增端点漏登记会在这里挂）", () => {
		const orphans: string[] = [];
		for (const key of keys) {
			if (domainOf(key) === null) {
				orphans.push(key.slice("GET ".length));
			}
		}
		expect(orphans).toEqual([]);
	});

	it("表里的每个域都有真实端点（无幽灵域）", () => {
		const used = new Set(
			keys.map((k) => domainOf(k)).filter((d) => d !== null),
		);
		const declared = Object.keys(DOMAIN_POLICIES);
		expect([...used].sort()).toEqual([...declared].sort());
	});
});
