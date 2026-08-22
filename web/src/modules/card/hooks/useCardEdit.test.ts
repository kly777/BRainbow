// ── useCardEdit 编辑生命周期（测试覆盖扩充）──
// ID 解析 / dirty / 时间戳标签 / 保存与删除分支 / 快捷键。
// 注意：createResource 的解析时序在 jsdom 下不稳定，
// 仅保留一个资源同步用例，其余走不依赖资源的纯分支。

import { deleteCardE, getCardE, updateCardE } from "@modules/card";
import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCardEdit } from "./useCardEdit.ts";

const routeParams: Record<string, string> = { id: "42" };
const navigateMock = vi.fn();
vi.mock("@solidjs/router", () => ({
	useParams: () => routeParams,
	useNavigate: () => navigateMock,
}));
vi.mock("@modules/card", () => ({
	deleteCardE: vi.fn(),
	getCardE: vi.fn(),
	updateCardE: vi.fn(),
}));
const confirmResolve = vi.fn();
vi.mock("@lib/utils", async (importOriginal) => {
	const mod = await importOriginal<typeof import("@lib/utils")>();
	return { ...mod, showConfirm: () => confirmResolve() };
});

const mockedGet = vi.mocked(getCardE);
const mockedUpdate = vi.mocked(updateCardE);
const mockedDelete = vi.mocked(deleteCardE);
const fullCard = (content: string, sameStamp = true) => ({
	id: 42,
	content,
	created_at: "2026-08-22T00:00:00+00:00",
	updated_at: sameStamp
		? "2026-08-22T00:00:00+00:00"
		: "2026-08-22T09:00:00+00:00",
});
const flush = () => new Promise((r) => setTimeout(r, 0));
async function waitUntil(cond: () => boolean, tries = 100) {
	for (let i = 0; i < tries && !cond(); i++) await flush();
}

beforeEach(() => {
	vi.clearAllMocks();
	for (const k of Object.keys(routeParams)) delete routeParams[k];
	routeParams.id = "42";
	confirmResolve.mockResolvedValue(true);
	// 资源在 hook 挂载瞬间即发起请求，默认返回值必须先就位
	mockedGet.mockResolvedValue(fullCard("原始内容"));
	mockedUpdate.mockResolvedValue(undefined as never);
	mockedDelete.mockResolvedValue(undefined);
});

function withHook<T>(
	fn: (h: ReturnType<typeof useCardEdit>) => T | Promise<T>,
) {
	return new Promise<T>((resolve, reject) => {
		createRoot(async (dispose) => {
			const h = useCardEdit();
			try {
				resolve(await fn(h));
			} catch (e) {
				reject(e as Error);
			} finally {
				dispose();
			}
		});
	});
}

describe("cardId 解析", () => {
	it("合法数字 id 正常解析", () => {
		return withHook((h) => {
			expect(h.cardId()).toBe(42);
		});
	});

	it("非法 id 解析为 NaN", () => {
		return withHook((h) => {
			// 挂载后改写参数：cardId 为非响应式读取，可安全验证解析逻辑
			// 且不触发资源重新请求（避免 fetcher 抛错的未处理拒绝）
			routeParams.id = "abc";
			expect(Number.isNaN(h.cardId())).toBe(true);
			routeParams.id = "42";
			expect(h.cardId()).toBe(42);
		});
	});
});

describe("资源加载与派生态", () => {
	it("加载后 content 同步，dirty 随编辑翻转，时间戳按是否变更取标签", () => {
		return withHook(async (h) => {
			await waitUntil(() => h.content() !== ""); // 等 createEffect 同步
			expect(h.card()?.content).toBe("原始内容");
			expect(h.dirty()).toBe(false);
			h.setContent("原始!");
			expect(h.dirty()).toBe(true);
			h.setContent("原始内容");
			expect(h.dirty()).toBe(false);
			expect(h.stampLabel()).toBe("创建于");
			expect(h.stamp()).toBe("2026-08-22T00:00:00+00:00");
		});
	});
});

describe("doSave（不依赖资源加载）", () => {
	it("空内容拒绝且不发请求", () => {
		return withHook(async (h) => {
			h.setContent(" ");
			await h.doSave();
			expect(h.error()).toBe("内容不能为空");
			expect(mockedUpdate).not.toHaveBeenCalled();
		});
	});

	it("成功以 trim 内容更新并跳详情页", () => {
		return withHook(async (h) => {
			h.setContent("  新内容  ");
			await h.doSave();
			expect(mockedUpdate).toHaveBeenCalledWith(42, { content: "新内容" });
			expect(navigateMock).toHaveBeenCalledWith("/card/42");
			expect(h.isSubmitting()).toBe(false);
		});
	});

	it("失败展示错误不跳转", () => {
		return withHook(async (h) => {
			mockedUpdate.mockRejectedValue(new Error("并发冲突"));
			h.setContent("新");
			await h.doSave();
			expect(h.error()).toContain("并发冲突");
			expect(navigateMock).not.toHaveBeenCalled();
			expect(h.isSubmitting()).toBe(false);
		});
	});
});

describe("handleDelete 与快捷键", () => {
	it("取消确认不删除", () => {
		return withHook(async (h) => {
			confirmResolve.mockResolvedValue(false);
			await h.handleDelete();
			expect(mockedDelete).not.toHaveBeenCalled();
			expect(navigateMock).not.toHaveBeenCalled();
		});
	});

	it("确认并删除成功后跳回列表", () => {
		return withHook(async (h) => {
			await h.handleDelete();
			expect(mockedDelete).toHaveBeenCalledWith(42);
			expect(navigateMock).toHaveBeenCalledWith("/card");
		});
	});

	it("Ctrl/Cmd+s 触发保存路径（空内容可观测）", () => {
		return withHook((h) => {
			h.setContent("");
			h.onKeyDown({
				key: "s",
				ctrlKey: true,
				preventDefault() {},
			} as KeyboardEvent);
			expect(h.error()).toBe("内容不能为空");
		});
	});

	it("无修饰键不触发保存", () => {
		return withHook((h) => {
			h.onKeyDown({
				key: "Enter",
				ctrlKey: false,
				preventDefault() {},
			} as KeyboardEvent);
			expect(h.error()).toBe("");
		});
	});
});
