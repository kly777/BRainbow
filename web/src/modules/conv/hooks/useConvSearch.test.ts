// ── useConvSearch 搜索状态与链接构造（测试覆盖扩充）──
// mock useUrlParams（路由耦合）与搜索 API，验证纯逻辑分支。
import { PATHS } from "@config/paths";
import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ConvSearchTab, useConvSearch } from "./useConvSearch.ts";

const paramStore: Record<string, string> = {};
const setSpy = vi.fn();
vi.mock("@lib/utils", async (importOriginal) => {
	const mod = await importOriginal<typeof import("@lib/utils")>();
	return {
		...mod,
		useUrlParams: () => ({
			get: (k: string) => paramStore[k] ?? "",
			set: setSpy,
		}),
	};
});
vi.mock("@modules/conv", () => ({
	searchConvE: vi.fn(async () => ({ hits: [], total: 0 })),
}));

function withHook<T>(
	fn: (api: ReturnType<typeof useConvSearch>) => T | Promise<T>,
) {
	return new Promise<T>((resolve) => {
		createRoot(async (dispose) => {
			const api = useConvSearch();
			await Promise.resolve(); // 让 onMount 入队回调执行
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

describe("handleSearch", () => {
	it("空白查询不写入 URL", () => {
		return withHook((h) => {
			h.setQuery("   ");
			h.handleSearch({ preventDefault() {} } as SubmitEvent);
			expect(setSpy).not.toHaveBeenCalled();
		});
	});

	it("非空查询 trim 后写入并保留当前 tab", () => {
		return withHook((h) => {
			paramStore.t = "article";
			h.setQuery("  量子力学  ");
			h.handleSearch({ preventDefault() {} } as SubmitEvent);
			expect(setSpy).toHaveBeenCalledOnce();
			const arg = setSpy.mock.calls[0][0] as Record<string, string>;
			expect(arg.q).toBe("量子力学");
			expect(arg.t).toBe("article");
		});
	});

	it("onMount 从 URL 恢复初始查询词", () => {
		paramStore.q = "恢复的词";
		return withHook((h) => {
			expect(h.query()).toBe("恢复的词");
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
