import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBookmarkImport } from "./useBookmarkImport.ts";

// 模拟依赖
vi.mock("@modules/bookmark/api.ts", () => ({
	importBookmarksE: vi.fn(),
}));

vi.mock("@shared/utils", () => ({
	notifyError: vi.fn(),
	notifySuccess: vi.fn(),
	tryAsync: vi.fn(),
}));

describe("useBookmarkImport", () => {
	let opts: any;
	let onImportedMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		onImportedMock = vi.fn();
		opts = { onImported: onImportedMock };
	});

	it("管理导入状态", async () => {
		// 测试管理导入状态
		await createRoot(async (dispose) => {
			try {
				const importHook = useBookmarkImport(opts);

				// 验证初始状态
				expect(importHook.importing()).toBe(false);
			} finally {
				dispose();
			}
		});
	});

	it("处理文件导入", async () => {
		// 测试处理文件导入
		const { importBookmarksE } = await import("@modules/bookmark/api.ts");
		const mockImportBookmarksE = vi.mocked(importBookmarksE);
		const { tryAsync } = await import("@shared/utils");
		const mockTryAsync = vi.mocked(tryAsync);

		const mockResult = {
			created: 5,
			merged: 2,
			total: 7,
		};

		// 模拟tryAsync实际调用传入的函数
		mockTryAsync.mockImplementationOnce(async (fn) => {
			const result = await fn();
			return { ok: true, value: result };
		});

		// 模拟importBookmarksE返回成功结果
		mockImportBookmarksE.mockResolvedValueOnce(mockResult);

		await createRoot(async (dispose) => {
			try {
				const importHook = useBookmarkImport(opts);

				// 创建模拟文件
				const mockFile = new File(["<html>"], "bookmarks.html", {
					type: "text/html",
				});

				// 导入文件
				await importHook.handleImportFile(mockFile);

				// 验证importBookmarksE被调用
				expect(mockImportBookmarksE).toHaveBeenCalledTimes(1);
				expect(mockImportBookmarksE).toHaveBeenCalledWith(mockFile);

				// 验证onImported被调用
				expect(onImportedMock).toHaveBeenCalledTimes(1);

				// 验证importing状态
				expect(importHook.importing()).toBe(false);
			} finally {
				dispose();
			}
		});
	});

	it("处理导入失败", async () => {
		// 测试处理导入失败
		const { tryAsync } = await import("@shared/utils");
		const mockTryAsync = vi.mocked(tryAsync);
		const { notifyError } = await import("@shared/utils");
		const mockNotifyError = vi.mocked(notifyError);

		// 模拟tryAsync返回失败结果
		mockTryAsync.mockResolvedValueOnce({
			ok: false,
			error: new Error("Network error"),
		});

		await createRoot(async (dispose) => {
			try {
				const importHook = useBookmarkImport(opts);

				// 创建模拟文件
				const mockFile = new File(["<html>"], "bookmarks.html", {
					type: "text/html",
				});

				// 导入文件
				await importHook.handleImportFile(mockFile);

				// 验证错误被处理
				expect(mockNotifyError).toHaveBeenCalledWith(
					"导入失败",
					expect.objectContaining({ message: "Network error" }),
				);

				// 验证onImported没有被调用
				expect(onImportedMock).not.toHaveBeenCalled();

				// 验证importing状态
				expect(importHook.importing()).toBe(false);
			} finally {
				dispose();
			}
		});
	});

	it("处理未选择文件", async () => {
		// 测试处理未选择文件
		await createRoot(async (dispose) => {
			try {
				const importHook = useBookmarkImport(opts);

				// 导入未选择文件
				await importHook.handleImportFile(undefined);

				// 验证importing状态没有变化
				expect(importHook.importing()).toBe(false);
			} finally {
				dispose();
			}
		});
	});
});
