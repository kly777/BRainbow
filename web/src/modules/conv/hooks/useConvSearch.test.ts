// ── useConvSearch 搜索状态与链接构造（测试覆盖扩充）──
// mock useUrlParams（路由耦合）与搜索 API，验证纯逻辑分支。
import { PATHS } from "@config/paths";
import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ConvSearchTab, useConvSearch } from "./useConvSearch.ts";

const paramStore: Record<string, string> = {};
const setSpy = vi.fn();
vi.mock("@shared/utils", async (importOriginal) => {
	const mod = await importOriginal<typeof import("@shared/utils")>();
	return {
		...mod,
		useUrlParams: () => ({
			get: (k: string) => paramStore[k] ?? "",
			set: (
				patch: Record<string, string | undefined>,
				opts?: { replace?: boolean },
			) => {
				// 模拟真实 URL 语义：undefined 删除参数，其余写入
				for (const [k, v] of Object.entries(patch)) {
					if (v === undefined) delete paramStore[k];
					else paramStore[k] = String(v);
				}
				setSpy(patch, opts);
			},
		}),
	};
});
vi.mock("@modules/conv/api.ts", () => ({
	searchConvE: vi.fn(async () => ({ hits: [], total: 0 })),
}));

function withHook<T>(
	fn: (api: ReturnType<typeof useConvSearch>) => T | Promise<T>,
) {
	return new Promise<T>((resolve) => {
		createRoot(async (dispose) => {
			const api = useConvSearch();
			await Promise.resolve();
			try {
				resolve(await fn(api));
			} finally {
				dispose();
			}
		});
	});
}

beforeEach(() => {
	for (const k of Object.keys(paramStore)) delete paramStore[k];
	setSpy.mockClear();
});

describe("tab 解析", () => {
	it("合法 tab 原样返回，非法/缺省回退 all", () => {
		return withHook((h) => {
			paramStore.t = "article";
			expect(h.tab()).toBe<ConvSearchTab>("article");
			paramStore.t = "bogus";
			expect(h.tab()).toBe<ConvSearchTab>("all");
			delete paramStore.t;
			expect(h.tab()).toBe<ConvSearchTab>("all");
		});
	});
});

describe("URL 驱动搜索", () => {
	it("键入即写 URL（trim 后），空白查询清空不触发搜索", () => {
		return withHook((h) => {
			h.setQuery("   ");
			// trim 后为空 → 写入空串（真实 useUrlParams 会移除该参数）
			expect(setSpy).toHaveBeenCalledWith({ q: "" }, { replace: true });
			h.handleSearch({ preventDefault() {} } as SubmitEvent);
			// 空白不追加写入（handleSearch 读到空 q 提前返回）
			expect(setSpy).toHaveBeenCalledTimes(1);
			expect(h.searchQuery()).toBe("");
		});
	});

	it("非空查询 trim 后写入，提交时同步保留当前 tab", () => {
		return withHook((h) => {
			paramStore.t = "article";
			h.setQuery("  量子力学  ");
			expect(setSpy.mock.calls[0][0]).toEqual({ q: "量子力学" });
			h.handleSearch({ preventDefault() {} } as SubmitEvent);
			expect(setSpy.mock.calls[1][0]).toEqual({
				q: "量子力学",
				t: "article",
			});
		});
	});

	it("初始 URL q 即输入值与搜索词（URL 单一来源）", () => {
		paramStore.q = "恢复的词";
		return withHook((h) => {
			expect(h.query()).toBe("恢复的词");
			expect(h.searchQuery()).toBe("恢复的词");
		});
	});
});

describe("itemHref 链接构造", () => {
	it("普通命中 → convDetail + 当前查询串", () => {
		return withHook((h) => {
			paramStore.q = "量子";
			delete paramStore.t;
			const href = h.itemHref({
				conv_id: 5,
				title: "t",
				conv_type: "concept",
				snippet: "s",
				match_field: "title",
				created_at: "",
				score: 1,
			});
			expect(href).toBe("/conversation/detail/5?q=%E9%87%8F%E5%AD%90");
		});
	});

	it("文章命中且带标题 → convConcept + article 参数优先", () => {
		return withHook((h) => {
			paramStore.q = "量子";
			paramStore.t = "article";
			const href = h.itemHref({
				conv_id: 9,
				title: "t",
				conv_type: "explanation",
				snippet: "s",
				match_field: "article",
				created_at: "",
				score: 1,
				article_title: "一次函数",
			});
			expect(href.startsWith("/conversation/concept/9?")).toBe(true);
			expect(href).toContain("article=");
			expect(href).toContain("q=");
		});
	});

	it("无查询词时不带 q 参数", () => {
		return withHook((h) => {
			const href = h.itemHref({
				conv_id: 3,
				title: "t",
				conv_type: "summary",
				snippet: "s",
				match_field: "title",
				created_at: "",
				score: 1,
			});
			expect(href).toBe(PATHS.convDetail.replace(":id", "3"));
		});
	});
});
