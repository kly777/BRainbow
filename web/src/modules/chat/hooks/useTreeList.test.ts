import { createRoot } from "solid-js";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useTreeList } from "./useTreeList.ts";

// 模拟依赖
vi.mock("@shared/utils", () => ({
	parseUrlId: vi.fn((id) => parseInt(id)),
	strParam: vi.fn((defaultVal) => ({ default: defaultVal })),
	useUrlParams: vi.fn(() => ({
		get: vi.fn(() => ""),
		set: vi.fn(),
	})),
	confirmAndRun: vi.fn(),
	notifyError: vi.fn(),
	notifySuccess: vi.fn(),
	tryAsync: vi.fn(),
	tryOrNotify: vi.fn(),
}));

vi.mock("@modules/chat", () => ({
	createTreeE: vi.fn(),
	deleteTreeE: vi.fn(),
	generateTreeTitleE: vi.fn(),
	getTreeE: vi.fn(),
	listTreesE: vi.fn(),
	updateTreeE: vi.fn(),
}));

describe("useTreeList", () => {
	let opts: any;

	beforeEach(() => {
		opts = {
			createTitle: "新对话",
			createKind: "chat",
			createLabel: "创建会话",
			listTreesFn: vi.fn(),
		};
	});

	it("加载树列表", async () => {
		// 测试加载树列表
		const { tryAsync } = await import("@shared/utils");
		const mockTryAsync = vi.mocked(tryAsync);
		
		const mockTrees = [
			{ id: 1, title: "对话1", created_at: "2024-01-01" },
			{ id: 2, title: "对话2", created_at: "2024-01-02" },
		];
		
		// 模拟tryAsync返回成功结果
		mockTryAsync.mockResolvedValueOnce({ ok: true, value: mockTrees });

		await createRoot(async (dispose) => {
			try {
				const treeList = useTreeList(opts);
				
				// 加载树列表
				await treeList.loadTrees();
				
				// 验证树列表被加载
				expect(treeList.trees()).toEqual(mockTrees);
				expect(treeList.loadingTrees()).toBe(false);
				
			} finally {
				dispose();
			}
		});
	});

	it("加载单个树", async () => {
		// 测试加载单个树
		const { tryAsync } = await import("@shared/utils");
		const mockTryAsync = vi.mocked(tryAsync);
		const { getTreeE } = await import("@modules/chat");
		const mockGetTreeE = vi.mocked(getTreeE);
		
		const mockTree = {
			tree: { id: 1, title: "对话1", created_at: "2024-01-01" },
			nodes: [
				{ id: 1, parent_id: null, role: "user", content: "Hello" },
				{ id: 2, parent_id: 1, role: "assistant", content: "Hi" },
			],
		};
		
		// 模拟getTreeE返回成功结果
		mockGetTreeE.mockResolvedValueOnce(mockTree);
		
		// 模拟tryAsync实际调用传入的函数
		mockTryAsync.mockImplementationOnce(async (fn) => {
			const result = await fn();
			return { ok: true, value: result };
		});

		await createRoot(async (dispose) => {
			try {
				const treeList = useTreeList(opts);
				
				// 清除之前的调用记录
				mockGetTreeE.mockClear();
				
				// 加载单个树
				await treeList.loadTree(1);
				
				// 验证getTreeE被调用
				expect(mockGetTreeE).toHaveBeenCalledWith(1);
				
			} finally {
				dispose();
			}
		});
	});

	it("创建新会话", async () => {
		// 测试创建新会话
		const { tryOrNotify } = await import("@shared/utils");
		const mockTryOrNotify = vi.mocked(tryOrNotify);
		
		const mockResult = {
			tree: { id: 3, title: "新对话", created_at: "2024-01-03" },
		};
		
		// 模拟tryOrNotify返回成功结果
		mockTryOrNotify.mockResolvedValueOnce(mockResult);

		await createRoot(async (dispose) => {
			try {
				const treeList = useTreeList(opts);
				
				// 创建新会话
				await treeList.createSession();
				
				// 验证tryOrNotify被调用
				expect(mockTryOrNotify).toHaveBeenCalledTimes(1);
				
			} finally {
				dispose();
			}
		});
	});

	it("删除会话", async () => {
		// 测试删除会话
		const { deleteTreeE } = await import("@modules/chat");
		const mockDeleteTreeE = vi.mocked(deleteTreeE);
		const { confirmAndRun } = await import("@shared/utils");
		const mockConfirmAndRun = vi.mocked(confirmAndRun);
		
		// 模拟confirmAndRun返回true
		mockConfirmAndRun.mockImplementationOnce(async (opts, fn) => {
			await fn();
			return true;
		});

		await createRoot(async (dispose) => {
			try {
				const treeList = useTreeList(opts);
				
				// 删除会话
				await treeList.removeSession(1);
				
				// 验证confirmAndRun被调用
				expect(mockConfirmAndRun).toHaveBeenCalledTimes(1);
				
				// 验证deleteTreeE被调用
				expect(mockDeleteTreeE).toHaveBeenCalledTimes(1);
				expect(mockDeleteTreeE).toHaveBeenCalledWith(1);
				
			} finally {
				dispose();
			}
		});
	});

	it("重命名会话", async () => {
		// 测试重命名会话
		const { updateTreeE } = await import("@modules/chat");
		const mockUpdateTreeE = vi.mocked(updateTreeE);
		const { tryOrNotify } = await import("@shared/utils");
		const mockTryOrNotify = vi.mocked(tryOrNotify);
		
		// 模拟tryOrNotify返回成功
		mockTryOrNotify.mockImplementationOnce(async (fn) => {
			await fn();
			return true;
		});

		await createRoot(async (dispose) => {
			try {
				const treeList = useTreeList(opts);
				
				// 重命名会话
				await treeList.renameSession(1, "新标题");
				
				// 验证updateTreeE被调用
				expect(mockUpdateTreeE).toHaveBeenCalledTimes(1);
				expect(mockUpdateTreeE).toHaveBeenCalledWith(1, { title: "新标题" });
				
			} finally {
				dispose();
			}
		});
	});

	it("AI生成标题", async () => {
		// 测试AI生成标题
		const { tryAsync } = await import("@shared/utils");
		const mockTryAsync = vi.mocked(tryAsync);
		const { generateTreeTitleE } = await import("@modules/chat");
		const mockGenerateTreeTitleE = vi.mocked(generateTreeTitleE);
		
		const mockResult = { title: "AI生成的标题" };
		
		// 模拟generateTreeTitleE返回成功结果
		mockGenerateTreeTitleE.mockResolvedValueOnce(mockResult);
		
		// 模拟tryAsync实际调用传入的函数
		mockTryAsync.mockImplementationOnce(async (fn) => {
			const result = await fn();
			return { ok: true, value: result };
		});

		await createRoot(async (dispose) => {
			try {
				const treeList = useTreeList(opts);
				
				// 清除之前的调用记录
				mockGenerateTreeTitleE.mockClear();
				
				// AI生成标题
				const result = await treeList.aiTitleSession(1);
				
				// 验证结果
				expect(result).toBe(true);
				
				// 验证generateTreeTitleE被调用
				expect(mockGenerateTreeTitleE).toHaveBeenCalledWith(1);
				
			} finally {
				dispose();
			}
		});
	});

	it("选择会话", async () => {
		// 测试选择会话
		const { useUrlParams } = await import("@shared/utils");
		const mockUseUrlParams = vi.mocked(useUrlParams);
		const mockSet = vi.fn();
		
		mockUseUrlParams.mockReturnValueOnce({
			get: vi.fn(() => ""),
			set: mockSet,
		});

		await createRoot(async (dispose) => {
			try {
				const treeList = useTreeList(opts);
				
				// 选择会话
				treeList.selectSession(123);
				
				// 验证set被调用
				expect(mockSet).toHaveBeenCalledWith({ tree: "123" });
				
			} finally {
				dispose();
			}
		});
	});
});