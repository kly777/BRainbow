// ── 路由级预取的契约（阶段 6）──
// 这里钉的不是"预取能提速"（那要浏览器才能测），而是三件会静默出错的事：
// ① 参数没解析对 → 预取了错的对象（甚至打到 /card/NaN）；
// ② 预取抛错 → 路由器那个调用点不 await 也不 catch，会变成未处理的 Promise 拒绝
//    （仓库在 P1-5 上踩过同一类坑：一个未处理拒绝就能让页面卡在加载态）；
// ③ 配置的路径与真实路由对不上 → 预取永远不触发，且没人会发现。

import { PAGE_PRELOADS, shouldPrefetch } from "@app/route-preloads.ts";
import { ROUTES, toRouteDefs } from "@app/routes.ts";
import { PATHS } from "@config/paths";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@modules/card/api.ts", () => ({ getCardE: vi.fn() }));
vi.mock("@modules/ontology/api.ts", () => ({ getOntoE: vi.fn() }));
vi.mock("@modules/bookmark/api.ts", () => ({ getBookmarkE: vi.fn() }));
vi.mock("@modules/task/api.ts", () => ({ getTaskDetailE: vi.fn() }));
vi.mock("@modules/conv/api.ts", () => ({ getConvDetailE: vi.fn() }));
vi.mock("@modules/file/api.ts", () => ({ getFile: vi.fn() }));

const { getCardE } = await import("@modules/card/api.ts");
const { getOntoE } = await import("@modules/ontology/api.ts");
const { getBookmarkE } = await import("@modules/bookmark/api.ts");
const { getTaskDetailE } = await import("@modules/task/api.ts");
const { getConvDetailE } = await import("@modules/conv/api.ts");
const { getFile } = await import("@modules/file/api.ts");

const run = (
	path: string,
	params: Record<string, string>,
): Promise<void> | undefined =>
	PAGE_PRELOADS[path as keyof typeof PAGE_PRELOADS]?.({
		params,
		// 预取函数不用 location，但类型要完整；这里给一个最小的合法 Location
		location: {
			query: {},
			state: null,
			key: "",
			pathname: "/",
			search: "",
			hash: "",
		},
	});

beforeEach(() => {
	vi.clearAllMocks();
	for (const fn of [
		getCardE,
		getOntoE,
		getBookmarkE,
		getTaskDetailE,
		getConvDetailE,
		getFile,
	]) {
		vi.mocked(fn).mockResolvedValue({} as never);
	}
});

describe("PAGE_PRELOADS 配置", () => {
	it("配了预取的路径确实是带 :id 的详情路由", () => {
		const keys = Object.keys(PAGE_PRELOADS);
		expect(keys.length).toBeGreaterThan(0);
		for (const path of keys) {
			expect(path.endsWith(":id")).toBe(true);
		}
	});

	it("每条路径都能在 PATHS 里找到（防手写字符串漂移）", () => {
		const known = new Set<string>(Object.values(PATHS));
		for (const path of Object.keys(PAGE_PRELOADS)) {
			expect(known.has(path)).toBe(true);
		}
	});
});

const location = {
	query: {},
	state: null,
	key: "",
	pathname: "/",
	search: "",
	hash: "",
} as const;

describe("与路由定义的接线", () => {
	it("详情路由挂上了预取，非详情路由没有", () => {
		const defs = toRouteDefs(ROUTES);
		expect(defs.find((d) => d.path === PATHS.cardDetail)?.preload).toBeTypeOf(
			"function",
		);
		expect(defs.find((d) => d.path === PATHS.home)?.preload).toBeUndefined();
	});

	it("只有预取意图（悬停）才会真的取数，导航/首屏不重复取", async () => {
		const preload = toRouteDefs(ROUTES).find(
			(d) => d.path === PATHS.cardDetail,
		)?.preload;
		expect(preload).toBeTypeOf("function");

		await preload?.({ params: { id: "42" }, location, intent: "navigate" });
		expect(getCardE).not.toHaveBeenCalled();

		await preload?.({ params: { id: "42" }, location, intent: "preload" });
		expect(getCardE).toHaveBeenCalledWith(42);
	});

	it("shouldPrefetch 只认 preload 意图", () => {
		expect(shouldPrefetch("preload")).toBe(true);
		for (const intent of ["initial", "native", "navigate"] as const) {
			expect(shouldPrefetch(intent)).toBe(false);
		}
	});
});

describe("数字 id 的预取", () => {
	it("合法 id 用解析后的数字调用与页面相同的取数函数", async () => {
		await run(PATHS.cardDetail, { id: "42" });
		expect(getCardE).toHaveBeenCalledWith(42);
		await run(PATHS.ontologyDetail, { id: "7" });
		expect(getOntoE).toHaveBeenCalledWith(7);
		await run(PATHS.bookmarkDetail, { id: "9" });
		expect(getBookmarkE).toHaveBeenCalledWith(9);
		await run(PATHS.taskDetail, { id: "3" });
		expect(getTaskDetailE).toHaveBeenCalledWith(3);
		await run(PATHS.convDetail, { id: "11" });
		expect(getConvDetailE).toHaveBeenCalledWith(11);
	});

	it("非数字 / 0 / 缺失的 id 一律不发请求（把无效 ID 交给页面的错误态）", async () => {
		await run(PATHS.cardDetail, { id: "abc" });
		await run(PATHS.cardDetail, { id: "0" });
		await run(PATHS.cardDetail, { id: "-3" });
		await run(PATHS.cardDetail, { id: "1.5" });
		await run(PATHS.cardDetail, {});
		expect(getCardE).not.toHaveBeenCalled();
	});
});

describe("文件详情（stored_id 是字符串）", () => {
	it("原样把 stored_id 传给 getFile", async () => {
		await run(PATHS.fileDetail, { id: "AbC123xyz" });
		expect(getFile).toHaveBeenCalledWith("AbC123xyz");
	});

	it("缺参数时不发请求", async () => {
		await run(PATHS.fileDetail, {});
		expect(getFile).not.toHaveBeenCalled();
	});
});

describe("预取失败不能变成未处理的拒绝", () => {
	it("取数 reject 时预取本身仍然 resolve", async () => {
		vi.mocked(getCardE).mockRejectedValue(new Error("500"));
		await expect(run(PATHS.cardDetail, { id: "42" })).resolves.toBeUndefined();

		vi.mocked(getFile).mockRejectedValue(new Error("404"));
		await expect(run(PATHS.fileDetail, { id: "x" })).resolves.toBeUndefined();
	});
});
