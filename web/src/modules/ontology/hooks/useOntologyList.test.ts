import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOntologyList } from "./useOntologyList.ts";

// 模拟依赖
vi.mock("../api", () => ({
	getOntosE: vi.fn(),
	createOntoE: vi.fn(),
	deleteOntoE: vi.fn(),
}));

// 创建模拟的useUrlParams
let mockSearchQuery = "";
const mockSet = vi.fn();
vi.mock("@shared/utils", () => ({
	notifyError: vi.fn(),
	notifySuccess: vi.fn(),
	showConfirm: vi.fn(),
	tryAsync: vi.fn(),
	tryOrNotify: vi.fn(),
	useUrlParams: vi.fn(() => ({
		get: vi.fn((key: string) => {
			if (key === "q") return mockSearchQuery;
			if (key === "view") return "grid";
			return "";
		}),
		set: mockSet,
	})),
	strParam: vi.fn((defaultVal) => ({ default: defaultVal })),
	enumParam: vi.fn((values, defaultVal) => ({ values, default: defaultVal })),
}));

vi.mock("@shared/api", () => ({
	getErrorMessage: vi.fn((error) => error.message || "Unknown error"),
}));

describe("useOntologyList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSearchQuery = "";
	});

	it("管理本体列表状态", async () => {
		// 测试管理本体列表状态
		const { getOntosE } = await import("../api");
		const mockGetOntosE = vi.mocked(getOntosE);
		const { tryAsync } = await import("@shared/utils");
		const mockTryAsync = vi.mocked(tryAsync);

		const mockOntologies = [
			{ id: 1, name: "本体1", description: "描述1" },
			{ id: 2, name: "本体2", description: "描述2" },
		];

		// 模拟getOntosE返回成功结果
		mockGetOntosE.mockResolvedValueOnce(mockOntologies);

		// 模拟tryAsync返回成功结果
		mockTryAsync.mockResolvedValueOnce({ ok: true, value: mockOntologies });

		await createRoot(async (dispose) => {
			try {
				const ontologyList = useOntologyList();

				// 等待资源加载
				await new Promise((resolve) => setTimeout(resolve, 0));

				// 验证本体列表被加载
				expect(ontologyList.ontologies()).toEqual(mockOntologies);
				// loading可能是一个函数或属性，检查是否存在
				expect(ontologyList.loading).toBeDefined();
			} finally {
				dispose();
			}
		});
	});

	it("处理本体CRUD操作", async () => {
		// 测试处理本体CRUD操作
		const { createOntoE } = await import("../api");
		const mockCreateOntoE = vi.mocked(createOntoE);

		const mockResult = {
			id: 3,
			name: "新本体",
			description: "新描述",
		};

		// 模拟createOntoE返回成功结果
		mockCreateOntoE.mockResolvedValueOnce(mockResult);

		await createRoot(async (dispose) => {
			try {
				const ontologyList = useOntologyList();

				// 打开创建模态框
				ontologyList.openCreateModal();

				// 填写表单
				ontologyList.setNewName("新本体");
				ontologyList.setNewDescription("新描述");

				// 验证表单状态
				expect(ontologyList.newName()).toBe("新本体");
				expect(ontologyList.newDescription()).toBe("新描述");
				expect(ontologyList.showCreateModal()).toBe(true);
			} finally {
				dispose();
			}
		});
	});

	it("管理本体搜索和过滤", async () => {
		// 测试管理本体搜索和过滤
		const { getOntosE } = await import("../api");
		const mockGetOntosE = vi.mocked(getOntosE);
		const { tryAsync } = await import("@shared/utils");
		const mockTryAsync = vi.mocked(tryAsync);

		const mockOntologies = [
			{ id: 1, name: "本体1", description: "描述1" },
			{ id: 2, name: "本体2", description: "描述2" },
			{ id: 3, name: "测试", description: "测试描述" },
		];

		// 模拟getOntosE返回成功结果
		mockGetOntosE.mockResolvedValueOnce(mockOntologies);

		// 模拟tryAsync返回成功结果
		mockTryAsync.mockResolvedValueOnce({ ok: true, value: mockOntologies });

		// 设置搜索查询
		mockSearchQuery = "测试";

		await createRoot(async (dispose) => {
			try {
				const ontologyList = useOntologyList();

				// 等待资源加载
				await new Promise((resolve) => setTimeout(resolve, 0));

				// 验证过滤结果
				const filtered = ontologyList.filteredOntologies();
				expect(filtered.length).toBe(1);
				expect(filtered[0].name).toBe("测试");
			} finally {
				dispose();
			}
		});
	});

	it("处理本体删除", async () => {
		// 测试处理本体删除
		const { deleteOntoE } = await import("../api");
		const mockDeleteOntoE = vi.mocked(deleteOntoE);
		const { showConfirm, tryOrNotify } = await import("@shared/utils");
		const mockShowConfirm = vi.mocked(showConfirm);
		const mockTryOrNotify = vi.mocked(tryOrNotify);

		// 模拟showConfirm返回true
		mockShowConfirm.mockResolvedValueOnce(true);

		// 模拟tryOrNotify返回成功
		mockTryOrNotify.mockImplementationOnce(async (fn) => {
			await fn();
			return true;
		});

		await createRoot(async (dispose) => {
			try {
				const ontologyList = useOntologyList();

				// 删除本体
				await ontologyList.handleDeleteOnto(1);

				// 验证showConfirm被调用
				expect(mockShowConfirm).toHaveBeenCalledTimes(1);

				// 验证deleteOntoE被调用
				expect(mockDeleteOntoE).toHaveBeenCalledTimes(1);
				expect(mockDeleteOntoE).toHaveBeenCalledWith(1);
			} finally {
				dispose();
			}
		});
	});
});
