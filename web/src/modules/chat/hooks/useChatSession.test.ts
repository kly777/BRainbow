import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession.ts";

// 模拟依赖
vi.mock("@shared/utils", () => ({
	parseUrlId: vi.fn((id) => parseInt(id, 10)),
	strParam: vi.fn((defaultVal) => ({ default: defaultVal })),
	useUrlParams: vi.fn(() => ({
		get: vi.fn(() => ""),
		set: vi.fn(),
	})),
}));

vi.mock("@solidjs/router", () => ({
	useNavigate: vi.fn(() => vi.fn()),
}));

vi.mock("./useTreeList.ts", () => ({
	useTreeList: vi.fn(() => ({
		trees: () => [],
		loadingTrees: () => false,
		current: () => null,
		setCurrent: vi.fn(),
		treeId: () => null,
		loadTrees: vi.fn(),
		loadTree: vi.fn(),
		createSession: vi.fn(),
		removeSession: vi.fn(),
		renameSession: vi.fn(),
		aiTitleSession: vi.fn(),
		selectSession: vi.fn(),
	})),
}));

vi.mock("./useTreeFocus.ts", () => ({
	useTreeFocus: vi.fn(() => ({
		childrenOf: vi.fn(),
		activePath: () => [],
		lastNode: () => null,
		findNode: vi.fn(),
		focusBranch: vi.fn(),
		isInSubtree: vi.fn(),
	})),
}));

vi.mock("./useStreamChat.ts", () => ({
	useStreamChat: vi.fn(() => ({
		sending: () => false,
		setSending: vi.fn(),
		streamingContent: () => "",
		streamingReasoning: () => "",
		input: () => "",
		setInput: vi.fn(),
		streamChat: vi.fn(),
		stopStreaming: vi.fn(),
	})),
}));

describe("useChatSession", () => {
	/** 被测 hook 的入参：按真实签名取（原来是 any，改完能查出漏字段） */
	let opts: Parameters<typeof useChatSession>[0];

	beforeEach(() => {
		opts = {
			createTitle: "新对话",
			createLabel: "新建会话",
		};
	});

	it("组合三个子hook", async () => {
		// 测试组合三个子hook
		const { useTreeList } = await import("./useTreeList.ts");
		const { useTreeFocus } = await import("./useTreeFocus.ts");
		const { useStreamChat } = await import("./useStreamChat.ts");

		await createRoot(async (dispose) => {
			try {
				const session = useChatSession(opts);

				// 验证useTreeList被调用
				expect(useTreeList).toHaveBeenCalledTimes(1);
				expect(useTreeList).toHaveBeenCalledWith(opts);

				// 验证useTreeFocus被调用
				expect(useTreeFocus).toHaveBeenCalledTimes(1);

				// 验证useStreamChat被调用
				expect(useStreamChat).toHaveBeenCalledTimes(1);

				// 验证返回的API包含所有必要的方法
				expect(session.trees).toBeDefined();
				expect(session.loadingTrees).toBeDefined();
				expect(session.current).toBeDefined();
				expect(session.treeId).toBeDefined();
				expect(session.loadTrees).toBeDefined();
				expect(session.loadTree).toBeDefined();
				expect(session.createSession).toBeDefined();
				expect(session.removeSession).toBeDefined();
				expect(session.renameSession).toBeDefined();
				expect(session.aiTitleSession).toBeDefined();
				expect(session.selectSession).toBeDefined();
				expect(session.focusId).toBeDefined();
				expect(session.setFocusParam).toBeDefined();
				expect(session.urlParams).toBeDefined();
				expect(session.nodes).toBeDefined();
				expect(session.childrenOf).toBeDefined();
				expect(session.activePath).toBeDefined();
				expect(session.lastNode).toBeDefined();
				expect(session.findNode).toBeDefined();
				expect(session.focusBranch).toBeDefined();
				expect(session.isInSubtree).toBeDefined();
				expect(session.sending).toBeDefined();
				expect(session.setSending).toBeDefined();
				expect(session.streamingContent).toBeDefined();
				expect(session.streamingReasoning).toBeDefined();
				expect(session.input).toBeDefined();
				expect(session.setInput).toBeDefined();
				expect(session.streamChat).toBeDefined();
				expect(session.stopStreaming).toBeDefined();
				expect(session.navigate).toBeDefined();
			} finally {
				dispose();
			}
		});
	});

	it("管理URL参数", async () => {
		// 测试URL参数管理
		const { useUrlParams } = await import("@shared/utils");
		const mockUseUrlParams = vi.mocked(useUrlParams);
		const mockGet = vi.fn(() => "");
		const mockSet = vi.fn();

		mockUseUrlParams.mockReturnValueOnce({
			get: mockGet,
			set: mockSet,
			setSearchParams: vi.fn(),
		});

		await createRoot(async (dispose) => {
			try {
				const session = useChatSession(opts);

				// 测试focusId
				const focusId = session.focusId();
				expect(focusId).toBeNull();

				// 测试setFocusParam
				session.setFocusParam(123);
				expect(mockSet).toHaveBeenCalledWith({ node: "123" });

				// 测试setFocusParam with null
				session.setFocusParam(null);
				expect(mockSet).toHaveBeenCalledWith({ node: undefined });
			} finally {
				dispose();
			}
		});
	});

	it("提供统一的API接口", async () => {
		// 测试统一的API接口
		await createRoot(async (dispose) => {
			try {
				const session = useChatSession(opts);

				// 验证所有API方法都是函数
				expect(typeof session.loadTrees).toBe("function");
				expect(typeof session.loadTree).toBe("function");
				expect(typeof session.createSession).toBe("function");
				expect(typeof session.removeSession).toBe("function");
				expect(typeof session.renameSession).toBe("function");
				expect(typeof session.aiTitleSession).toBe("function");
				expect(typeof session.selectSession).toBe("function");
				expect(typeof session.setFocusParam).toBe("function");
				expect(typeof session.childrenOf).toBe("function");
				expect(typeof session.findNode).toBe("function");
				expect(typeof session.focusBranch).toBe("function");
				expect(typeof session.isInSubtree).toBe("function");
				expect(typeof session.setSending).toBe("function");
				expect(typeof session.setInput).toBe("function");
				expect(typeof session.streamChat).toBe("function");
				expect(typeof session.stopStreaming).toBe("function");
				expect(typeof session.navigate).toBe("function");
			} finally {
				dispose();
			}
		});
	});
});
