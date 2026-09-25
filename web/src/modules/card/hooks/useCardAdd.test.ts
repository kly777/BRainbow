// ── useCardAdd 表单生命周期（测试覆盖扩充，T4 card 模块零测试缺口）──
// mock 路由与 API 层，hook 在 createRoot 中运行（同 mem hooks 测试范式）。
import { createCardE } from "@modules/card";
import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCardAdd } from "./useCardAdd.ts";

vi.mock("@modules/card/api.ts", () => ({ createCardE: vi.fn() }));
const navigateMock = vi.fn();
vi.mock("@solidjs/router", () => ({
	useNavigate: () => navigateMock,
}));

const mockedCreate = vi.mocked(createCardE);

beforeEach(() => {
	vi.clearAllMocks();
});

/** 在响应式根内驱动 hook */
function withHook<T>(
	fn: (api: ReturnType<typeof useCardAdd>) => T | Promise<T>,
) {
	return new Promise<T>((resolve) => {
		createRoot(async (dispose) => {
			const api = useCardAdd();
			try {
				resolve(await fn(api));
			} finally {
				dispose();
			}
		});
	});
}

function mkKey(ctrl: boolean, key: string): KeyboardEvent {
	return {
		key,
		ctrlKey: ctrl,
		metaKey: ctrl,
		preventDefault: vi.fn(),
	} as unknown as KeyboardEvent;
}

describe("canSave", () => {
	it("空白内容不可保存，非空可保存", () => {
		return withHook((h) => {
			h.setContent("");
			expect(h.canSave()).toBe(false);
			h.setContent("   ");
			expect(h.canSave()).toBe(false);
			h.setContent("第一张卡片");
			expect(h.canSave()).toBe(true);
		});
	});
});

describe("doCreate", () => {
	it("空内容拒绝提交并提示，不发请求", () => {
		return withHook(async (h) => {
			h.setContent("  ");
			await h.doCreate();
			expect(h.error()).toBe("内容不能为空");
			expect(mockedCreate).not.toHaveBeenCalled();
			expect(h.isSubmitting()).toBe(false);
		});
	});

	it("成功后以 trim 内容创建并跳转详情页", () => {
		return withHook(async (h) => {
			mockedCreate.mockResolvedValue({ id: 77 } as never);
			h.setContent("  有空白的内容  ");
			await h.doCreate();
			expect(mockedCreate).toHaveBeenCalledWith({ content: "有空白的内容" });
			expect(navigateMock).toHaveBeenCalledWith("/card/77");
			expect(h.isSubmitting()).toBe(false);
			expect(h.error()).toBe("");
		});
	});

	it("失败时展示错误信息并复位提交态", () => {
		return withHook(async (h) => {
			mockedCreate.mockRejectedValue(new Error("服务端炸了"));
			h.setContent("x");
			await h.doCreate();
			expect(h.isSubmitting()).toBe(false);
			expect(h.error()).toContain("服务端炸了");
			expect(navigateMock).not.toHaveBeenCalled();
		});
	});
});

describe("handleKeyDown", () => {
	it("Ctrl/Cmd+Enter 触发创建路径（空内容走错误分支可观测）", () => {
		return withHook((h) => {
			h.setContent("");
			h.handleKeyDown(mkKey(true, "Enter"));
			expect(h.error()).toBe("内容不能为空");
		});
	});

	it("无修饰键的 Enter 不触发", () => {
		return withHook((h) => {
			h.handleKeyDown(mkKey(false, "Enter"));
			expect(h.error()).toBe("");
		});
	});
});
