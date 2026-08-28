import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamChat } from "./useStreamChat.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	getToken: vi.fn(() => "mock-token"),
}));

vi.mock("./streamChatRequest.ts", () => ({
	streamChatRequest: vi.fn(),
}));

vi.mock("./chat-tree.ts", () => ({
	makeTempNode: vi.fn((id, parentId, role, content, treeId) => ({
		id,
		parent_id: parentId,
		role,
		content,
		tree_id: treeId,
		created_at: new Date().toISOString(),
	})),
}));

describe("useStreamChat", () => {
	let opts: any;
	let setCurrentMock: ReturnType<typeof vi.fn>;
	let loadTreeMock: ReturnType<typeof vi.fn>;
	let aiTitleSessionMock: ReturnType<typeof vi.fn>;
	let setFocusParamMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		setCurrentMock = vi.fn();
		loadTreeMock = vi.fn();
		aiTitleSessionMock = vi.fn();
		setFocusParamMock = vi.fn();

		opts = {
			treeId: () => 1,
			current: () => ({
				tree: { id: 1, title: "新对话" },
				nodes: [],
			}),
			setCurrent: setCurrentMock,
			focusId: () => null,
			setFocusParam: setFocusParamMock,
			nodes: () => [],
			activePath: () => [],
			loadTree: loadTreeMock,
			aiTitleSession: aiTitleSessionMock,
			createTitle: "新对话",
		};
	});

	it("流式聊天请求的管理", async () => {
		// 测试流式聊天请求的管理
		const { streamChatRequest } = await import("./streamChatRequest.ts");
		const mockStreamChatRequest = vi.mocked(streamChatRequest);

		// 模拟成功的流式响应
		mockStreamChatRequest.mockResolvedValueOnce({ ok: true, error: "" });

		await createRoot(async (dispose) => {
			try {
				const chat = useStreamChat(opts);

				// 发送消息
				const result = await chat.streamChat(null, "Hello");

				// 验证结果
				expect(result.ok).toBe(true);
				expect(result.error).toBe("");

				// 验证streamChatRequest被调用
				expect(mockStreamChatRequest).toHaveBeenCalledTimes(1);
				expect(mockStreamChatRequest).toHaveBeenCalledWith(
					1, // treeId
					null, // parentId
					"Hello", // content
					"mock-token", // token
					expect.any(AbortSignal), // signal
					expect.any(Function), // onPatch
				);

				// 验证loadTree被调用
				expect(loadTreeMock).toHaveBeenCalledTimes(1);
				expect(loadTreeMock).toHaveBeenCalledWith(1);
			} finally {
				dispose();
			}
		});
	});

	it("乐观UI更新：临时节点插入", async () => {
		// 测试乐观UI更新
		const { streamChatRequest } = await import("./streamChatRequest.ts");
		const mockStreamChatRequest = vi.mocked(streamChatRequest);

		// 模拟成功的流式响应
		mockStreamChatRequest.mockResolvedValueOnce({ ok: true, error: "" });

		await createRoot(async (dispose) => {
			try {
				const chat = useStreamChat(opts);

				// 发送消息
				await chat.streamChat(null, "Hello");

				// 验证setCurrent被调用（乐观更新）
				expect(setCurrentMock).toHaveBeenCalled();

				// 验证setFocusParam被调用
				expect(setFocusParamMock).toHaveBeenCalled();
			} finally {
				dispose();
			}
		});
	});

	it("错误处理和回滚", async () => {
		// 测试错误处理和回滚
		const { streamChatRequest } = await import("./streamChatRequest.ts");
		const mockStreamChatRequest = vi.mocked(streamChatRequest);

		// 模拟失败的流式响应
		mockStreamChatRequest.mockResolvedValueOnce({
			ok: false,
			error: "Network error",
		});

		await createRoot(async (dispose) => {
			try {
				const chat = useStreamChat(opts);

				// 发送消息
				const result = await chat.streamChat(null, "Hello");

				// 验证结果
				expect(result.ok).toBe(false);
				expect(result.error).toBe("Network error");

				// 验证setCurrent被调用（回滚）
				expect(setCurrentMock).toHaveBeenCalled();

				// 验证loadTree没有被调用（失败时不重拉树）
				expect(loadTreeMock).not.toHaveBeenCalled();
			} finally {
				dispose();
			}
		});
	});

	it("停止生成功能", async () => {
		// 测试停止生成功能
		const { streamChatRequest } = await import("./streamChatRequest.ts");
		const mockStreamChatRequest = vi.mocked(streamChatRequest);

		// 模拟长时间运行的流式响应
		mockStreamChatRequest.mockImplementationOnce(
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve({ ok: true, error: "" }), 1000),
				),
		);

		await createRoot(async (dispose) => {
			try {
				const chat = useStreamChat(opts);

				// 开始流式聊天
				const streamPromise = chat.streamChat(null, "Hello");

				// 停止生成
				chat.stopStreaming();

				// 等待完成
				const result = await streamPromise;

				// 验证结果（应该成功，因为中止被视为成功）
				expect(result.ok).toBe(true);
			} finally {
				dispose();
			}
		});
	});

	it("会话不存在时返回错误", async () => {
		// 测试会话不存在时的行为
		opts.treeId = () => null;

		await createRoot(async (dispose) => {
			try {
				const chat = useStreamChat(opts);

				// 发送消息
				const result = await chat.streamChat(null, "Hello");

				// 验证结果
				expect(result.ok).toBe(false);
				expect(result.error).toBe("会话不存在");
			} finally {
				dispose();
			}
		});
	});

	it("未登录时返回错误", async () => {
		// 测试未登录时的行为
		const { getToken } = await import("@shared/api");
		const mockGetToken = vi.mocked(getToken);
		mockGetToken.mockReturnValueOnce(null);

		await createRoot(async (dispose) => {
			try {
				const chat = useStreamChat(opts);

				// 发送消息
				const result = await chat.streamChat(null, "Hello");

				// 验证结果
				expect(result.ok).toBe(false);
				expect(result.error).toBe("未登录");
			} finally {
				dispose();
			}
		});
	});
});
