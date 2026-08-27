import { describe, expect, it, vi, beforeEach } from "vitest";
import { 
	listTreesE, 
	createTreeE, 
	getTreeE, 
	updateTreeE, 
	deleteTreeE, 
	chatE, 
	searchChatE, 
	listPresetsE, 
	createPresetE, 
	updatePresetE, 
	deletePresetE 
} from "./api.ts";

// 模拟依赖
vi.mock("@shared/api", () => ({
	request: vi.fn(),
}));

describe("chat API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("获取对话树列表", async () => {
		// 测试获取对话树列表
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		
		const mockTrees = [
			{
				id: 1,
				title: "测试对话",
				system_prompt: "你是一个助手",
				kind: "chat",
				created_at: "2024-01-01",
				updated_at: "2024-01-01",
				node_count: 5,
			},
		];
		
		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockTrees);

		// 调用获取对话树列表API
		const result = await listTreesE();
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/chat/trees", {});
		
		// 验证返回结果
		expect(result).toEqual(mockTrees);
	});

	it("创建对话树", async () => {
		// 测试创建对话树
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		
		const mockTree = {
			tree: {
				id: 2,
				title: "新对话",
				system_prompt: "你是一个助手",
				kind: "chat",
				created_at: "2024-01-02",
				updated_at: "2024-01-02",
				node_count: 0,
			},
			nodes: [],
		};
		
		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockTree);

		// 调用创建对话树API
		const result = await createTreeE("新对话", "你是一个助手", "chat");
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/chat/trees", {
			method: "POST",
			body: JSON.stringify({ title: "新对话", system_prompt: "你是一个助手", kind: "chat" }),
		});
		
		// 验证返回结果
		expect(result).toEqual(mockTree);
	});

	it("获取对话树详情", async () => {
		// 测试获取对话树详情
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		
		const mockTree = {
			tree: {
				id: 1,
				title: "测试对话",
				system_prompt: "你是一个助手",
				kind: "chat",
				created_at: "2024-01-01",
				updated_at: "2024-01-01",
				node_count: 5,
			},
			nodes: [
				{
					id: 1,
					tree_id: 1,
					parent_id: null,
					role: "user",
					content: "你好",
					revised_from: null,
					created_at: "2024-01-01",
				},
			],
		};
		
		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockTree);

		// 调用获取对话树详情API
		const result = await getTreeE(1);
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/chat/trees/1", {});
		
		// 验证返回结果
		expect(result).toEqual(mockTree);
	});

	it("更新对话树", async () => {
		// 测试更新对话树
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		
		const mockResult = { ok: true };
		
		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockResult);

		// 调用更新对话树API
		const result = await updateTreeE(1, { title: "新标题" });
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/chat/trees/1", {
			method: "PATCH",
			body: JSON.stringify({ title: "新标题" }),
		});
		
		// 验证返回结果
		expect(result).toEqual(mockResult);
	});

	it("删除对话树", async () => {
		// 测试删除对话树
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		
		const mockResult = { ok: true };
		
		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockResult);

		// 调用删除对话树API
		const result = await deleteTreeE(1);
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/chat/trees/1", { method: "DELETE" });
		
		// 验证返回结果
		expect(result).toEqual(mockResult);
	});

	it("发送聊天消息", async () => {
		// 测试发送聊天消息
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		
		const mockResult = {
			user: {
				id: 2,
				tree_id: 1,
				parent_id: 1,
				role: "user",
				content: "你好",
				revised_from: null,
				created_at: "2024-01-01",
			},
			assistant: {
				id: 3,
				tree_id: 1,
				parent_id: 2,
				role: "assistant",
				content: "你好！有什么可以帮助你的吗？",
				revised_from: null,
				created_at: "2024-01-01",
			},
		};
		
		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockResult);

		// 调用发送聊天消息API
		const result = await chatE(1, 1, "你好");
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/chat/trees/1/chat", {
			method: "POST",
			body: JSON.stringify({ parent_id: 1, content: "你好" }),
		});
		
		// 验证返回结果
		expect(result).toEqual(mockResult);
	});

	it("搜索对话", async () => {
		// 测试搜索对话
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		
		const mockResponse = {
			hits: [
				{
					tree_id: 1,
					tree_title: "测试对话",
					node_id: 1,
					role: "user",
					snippet: "你好",
					created_at: "2024-01-01",
				},
			],
		};
		
		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockResponse);

		// 调用搜索对话API
		const result = await searchChatE("你好");
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/chat/search?q=%E4%BD%A0%E5%A5%BD", {});
		
		// 验证返回结果
		expect(result).toEqual(mockResponse);
	});

	it("管理提示词预设", async () => {
		// 测试管理提示词预设
		const { request } = await import("@shared/api");
		const mockRequest = vi.mocked(request);
		
		const mockPresets = [
			{
				id: 1,
				name: "助手",
				content: "你是一个助手",
				created_at: "2024-01-01",
			},
		];
		
		const mockPreset = {
			id: 2,
			name: "翻译",
			content: "你是一个翻译",
			created_at: "2024-01-02",
		};
		
		const mockUpdateResult = { ok: true };
		const mockDeleteResult = { ok: true };
		
		// 模拟request返回成功结果
		mockRequest.mockResolvedValueOnce(mockPresets);
		mockRequest.mockResolvedValueOnce(mockPreset);
		mockRequest.mockResolvedValueOnce(mockUpdateResult);
		mockRequest.mockResolvedValueOnce(mockDeleteResult);

		// 调用获取提示词预设列表API
		const presetsResult = await listPresetsE();
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(1);
		expect(mockRequest).toHaveBeenCalledWith("/chat/prompts", {});
		
		// 验证返回结果
		expect(presetsResult).toEqual(mockPresets);
		
		// 调用创建提示词预设API
		const createResult = await createPresetE("翻译", "你是一个翻译");
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(2);
		expect(mockRequest).toHaveBeenCalledWith("/chat/prompts", {
			method: "POST",
			body: JSON.stringify({ name: "翻译", content: "你是一个翻译" }),
		});
		
		// 验证返回结果
		expect(createResult).toEqual(mockPreset);
		
		// 调用更新提示词预设API
		const updateResult = await updatePresetE(1, "新助手", "你是一个新助手");
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(3);
		expect(mockRequest).toHaveBeenCalledWith("/chat/prompts/1", {
			method: "PATCH",
			body: JSON.stringify({ name: "新助手", content: "你是一个新助手" }),
		});
		
		// 验证返回结果
		expect(updateResult).toEqual(mockUpdateResult);
		
		// 调用删除提示词预设API
		const deleteResult = await deletePresetE(1);
		
		// 验证request被调用
		expect(mockRequest).toHaveBeenCalledTimes(4);
		expect(mockRequest).toHaveBeenCalledWith("/chat/prompts/1", { method: "DELETE" });
		
		// 验证返回结果
		expect(deleteResult).toEqual(mockDeleteResult);
	});
});