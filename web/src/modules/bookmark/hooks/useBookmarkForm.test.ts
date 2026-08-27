import { createRoot } from "solid-js";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useBookmarkForm } from "./useBookmarkForm.ts";

// 模拟依赖
vi.mock("@modules/bookmark", () => ({
	createBookmarkE: vi.fn(),
	updateBookmarkE: vi.fn(),
	setBookmarkTagsE: vi.fn(),
}));

vi.mock("@shared/utils", () => ({
	notifySuccess: vi.fn(),
	tryAsync: vi.fn(),
}));

describe("useBookmarkForm", () => {
	let opts: any;
	let onSavedMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		onSavedMock = vi.fn();
		opts = { onSaved: onSavedMock };
	});

	it("管理书签表单状态", async () => {
		// 测试管理书签表单状态
		await createRoot(async (dispose) => {
			try {
				const form = useBookmarkForm(opts);
				
				// 验证初始状态
				expect(form.form.open).toBe(false);
				expect(form.form.editing).toBeNull();
				expect(form.form.title).toBe("");
				expect(form.form.url).toBe("");
				expect(form.form.desc).toBe("");
				expect(form.form.tags).toEqual([]);
				expect(form.form.saving).toBe(false);
				expect(form.form.error).toBeNull();
				
			} finally {
				dispose();
			}
		});
	});

	it("处理创建模式", async () => {
		// 测试处理创建模式
		await createRoot(async (dispose) => {
			try {
				const form = useBookmarkForm(opts);
				
				// 打开创建模式
				form.openCreate();
				
				// 验证状态
				expect(form.form.open).toBe(true);
				expect(form.form.editing).toBeNull();
				expect(form.form.title).toBe("");
				expect(form.form.url).toBe("");
				expect(form.form.desc).toBe("");
				expect(form.form.tags).toEqual([]);
				expect(form.form.error).toBeNull();
				
			} finally {
				dispose();
			}
		});
	});

	it("处理编辑模式", async () => {
		// 测试处理编辑模式
		await createRoot(async (dispose) => {
			try {
				const form = useBookmarkForm(opts);
				
				// 模拟书签数据
				const mockBookmark = {
					id: 1,
					title: "测试书签",
					url: "https://example.com",
					description: "测试描述",
					tags: ["tag1", "tag2"],
					created_at: "2024-01-01",
					updated_at: "2024-01-01",
				};
				
				// 打开编辑模式
				form.openEdit(mockBookmark);
				
				// 验证状态
				expect(form.form.open).toBe(true);
				expect(form.form.editing).toEqual(mockBookmark);
				expect(form.form.title).toBe("测试书签");
				expect(form.form.url).toBe("https://example.com");
				expect(form.form.desc).toBe("测试描述");
				expect(form.form.tags).toEqual(["tag1", "tag2"]);
				expect(form.form.error).toBeNull();
				
			} finally {
				dispose();
			}
		});
	});

	it("表单验证", async () => {
		// 测试表单验证
		await createRoot(async (dispose) => {
			try {
				const form = useBookmarkForm(opts);
				
				// 打开创建模式
				form.openCreate();
				
				// 测试空标题验证
				form.setForm("title", "");
				form.setForm("url", "https://example.com");
				await form.handleSave();
				expect(form.form.error).toBe("标题不能为空");
				
				// 测试无效URL验证
				form.setForm("title", "测试标题");
				form.setForm("url", "invalid-url");
				await form.handleSave();
				expect(form.form.error).toBe("URL 必须以 http:// 或 https:// 开头");
				
			} finally {
				dispose();
			}
		});
	});

	it("保存书签", async () => {
		// 测试保存书签
		const { createBookmarkE } = await import("@modules/bookmark");
		const mockCreateBookmarkE = vi.mocked(createBookmarkE);
		const { tryAsync } = await import("@shared/utils");
		const mockTryAsync = vi.mocked(tryAsync);
		
		const mockResult = {
			id: 1,
			title: "测试标题",
			url: "https://example.com",
			description: "测试描述",
			tags: ["tag1"],
			created_at: "2024-01-01",
			updated_at: "2024-01-01",
		};
		
		// 模拟tryAsync实际调用传入的函数
		mockTryAsync.mockImplementationOnce(async (fn) => {
			const result = await fn();
			return { ok: true, value: result };
		});
		
		// 模拟createBookmarkE返回成功结果
		mockCreateBookmarkE.mockResolvedValueOnce(mockResult);

		await createRoot(async (dispose) => {
			try {
				const form = useBookmarkForm(opts);
				
				// 打开创建模式
				form.openCreate();
				
				// 填写表单
				form.setForm("title", "测试标题");
				form.setForm("url", "https://example.com");
				form.setForm("desc", "测试描述");
				form.addTag("tag1");
				
				// 保存
				await form.handleSave();
				
				// 验证createBookmarkE被调用
				expect(mockCreateBookmarkE).toHaveBeenCalledTimes(1);
				
				// 验证onSaved被调用
				expect(onSavedMock).toHaveBeenCalledTimes(1);
				
			} finally {
				dispose();
			}
		});
	});
});