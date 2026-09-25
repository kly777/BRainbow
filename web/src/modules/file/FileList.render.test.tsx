// ── FileList 渲染回归测试：列表数据 → 卡片渲染（"上传成功但列表不显示"类回归封堵） ──

import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 模块级 mock：直接 mock 叶子模块 api.ts（mock index 会因 importOriginal
// 加载 FileList→useFileList 循环绑定到未 mock 的命名空间，导致 hook 走真实 fetch）
vi.mock("@modules/file/api.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@modules/file/api.ts")>();
	return {
		...actual,
		listFiles: vi.fn().mockResolvedValue({
			items: [
				{
					id: 1,
					stored_id: "abc123",
					url: "/api/file/abc123/data/test.png",
					original_name: "test.png",
					mime_type: "image/png",
					file_category: "image",
					size_bytes: 100,
					width: 2,
					height: 2,
					duration_ms: null,
					tags: [],
					created_at: "2026-09-09T13:00:00+00:00",
					updated_at: "2026-09-09T13:00:00+00:00",
					missing: false,
					is_private: false,
					can_edit: true,
				},
			],
			total: 1,
			page: 1,
			page_size: 20,
			total_pages: 1,
		}),
		listFileTags: vi.fn().mockResolvedValue([]),
		// 删除/改名等写操作也要是 mock（否则走真实实现，无法构造乐观/回滚场景）
		deleteFile: vi.fn().mockResolvedValue(undefined),
		updateFile: vi.fn().mockResolvedValue(undefined),
		// 列表页还会拉统计（页头总量 + 类别数量），jsdom 下必须 mock 掉
		getFileStats: vi.fn().mockResolvedValue({
			total_count: 1,
			total_bytes: 100,
			by_category: [{ category: "image", count: 1, bytes: 100 }],
		}),
	};
});

vi.mock("@solidjs/router", () => ({
	useNavigate: () => vi.fn(),
	useParams: () => ({}),
	useSearchParams: () => [{}, vi.fn()],
}));

// 删除前有确认弹窗：直接放行，聚焦"乐观更新"本身
vi.mock("@shared/utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@shared/utils")>();
	return { ...actual, showConfirm: vi.fn().mockResolvedValue(true) };
});

describe("FileList 渲染", () => {
	beforeEach(async () => {
		document.body.innerHTML = "";
		// 每个用例从"写操作正常成功"的默认桩开始，避免上一个用例的桩串味
		const { deleteFile, updateFile, listFiles } = await import(
			"@modules/file/api.ts"
		);
		vi.mocked(deleteFile).mockReset().mockResolvedValue(undefined);
		vi.mocked(updateFile)
			.mockReset()
			.mockResolvedValue(undefined as never);
		vi.mocked(listFiles).mockClear();
	});

	// 超时放宽：全量并行运行时模块加载/环境初始化可能超过默认 5s
	it("列表数据返回后渲染出文件卡片", async () => {
		const { default: FileList } = await import("./FileList.tsx");
		const host = document.createElement("div");
		document.body.appendChild(host);

		await createRoot(async (dispose) => {
			render(() => <FileList />, host);

			// 等待资源与微任务完成
			for (let i = 0; i < 50; i++) {
				await new Promise((r) => setTimeout(r, 20));
				if (host.querySelectorAll("img").length > 0) break;
			}

			expect(host.textContent).toContain("test.png");
			expect(host.querySelectorAll("img").length).toBeGreaterThan(0);
			dispose();
		});
	}, 20000);

	it("多页数据渲染出分页栏", async () => {
		const { listFiles } = await import("@modules/file/api.ts");
		vi.mocked(listFiles).mockResolvedValueOnce({
			items: [
				{
					id: 1,
					stored_id: "p2file",
					url: "/api/file/p2file/data/a.pdf",
					original_name: "a.pdf",
					mime_type: "application/pdf",
					file_category: "document",
					size_bytes: 10,
					width: null,
					height: null,
					duration_ms: null,
					tags: [],
					created_at: "2026-09-09T13:00:00+00:00",
					updated_at: "2026-09-09T13:00:00+00:00",
					missing: false,
					is_private: false,
					can_edit: true,
				},
			],
			total: 60,
			page: 1,
			page_size: 24,
			total_pages: 3,
		});

		const { default: FileList } = await import("./FileList.tsx");
		const host = document.createElement("div");
		document.body.appendChild(host);

		await createRoot(async (dispose) => {
			render(() => <FileList />, host);
			for (let i = 0; i < 50; i++) {
				await new Promise((r) => setTimeout(r, 20));
				if (host.querySelector("nav[aria-label='分页']")) break;
			}
			expect(host.querySelector("nav[aria-label='分页']")).toBeTruthy();
			expect(host.textContent).toContain("第 1 / 3 页");
			dispose();
		});
	}, 20000);

	it("私密文件显示锁标记且不在列表里拉取内容", async () => {
		const { listFiles } = await import("@modules/file/api.ts");
		vi.mocked(listFiles).mockResolvedValueOnce({
			items: [
				{
					id: 11,
					stored_id: "secret123456",
					url: "/api/file/secret123456/data/s.png",
					original_name: "s.png",
					mime_type: "image/png",
					file_category: "image",
					size_bytes: 10,
					width: 2,
					height: 2,
					duration_ms: null,
					tags: [],
					created_at: "2026-09-09T13:00:00+00:00",
					updated_at: "2026-09-09T13:00:00+00:00",
					missing: false,
					is_private: true,
					can_edit: true,
				},
			],
			total: 1,
			page: 1,
			page_size: 24,
			total_pages: 1,
		});

		const { default: FileList } = await import("./FileList.tsx");
		const host = document.createElement("div");
		document.body.appendChild(host);

		await createRoot(async (dispose) => {
			render(() => <FileList />, host);
			for (let i = 0; i < 50; i++) {
				await new Promise((r) => setTimeout(r, 20));
				if (host.textContent?.includes("私密")) break;
			}
			expect(host.textContent).toContain("私密");
			// 私密文件的内容不在列表里加载（<img> 不带凭据会 401）
			expect(host.querySelectorAll("img").length).toBe(0);
			dispose();
		});
	}, 20000);

	it("无权限的文件不显示重命名与删除按钮", async () => {
		const { listFiles } = await import("@modules/file/api.ts");
		vi.mocked(listFiles).mockResolvedValueOnce({
			items: [
				{
					id: 12,
					stored_id: "others123456",
					url: "/api/file/others123456/data/o.png",
					original_name: "o.png",
					mime_type: "image/png",
					file_category: "image",
					size_bytes: 10,
					width: 2,
					height: 2,
					duration_ms: null,
					tags: [],
					created_at: "2026-09-09T13:00:00+00:00",
					updated_at: "2026-09-09T13:00:00+00:00",
					missing: false,
					is_private: false,
					can_edit: false,
				},
			],
			total: 1,
			page: 1,
			page_size: 24,
			total_pages: 1,
		});

		const { default: FileList } = await import("./FileList.tsx");
		const host = document.createElement("div");
		document.body.appendChild(host);

		await createRoot(async (dispose) => {
			render(() => <FileList />, host);
			for (let i = 0; i < 50; i++) {
				await new Promise((r) => setTimeout(r, 20));
				if (host.textContent?.includes("o.png")) break;
			}
			expect(host.textContent).toContain("o.png");
			expect(host.textContent).not.toContain("重命名");
			expect(host.textContent).not.toContain("删除");
			dispose();
		});
	}, 20000);

	it("删除是乐观更新：确认后卡片立即消失，不等接口返回", async () => {
		const { listFiles, deleteFile } = await import("@modules/file/api.ts");
		// 接口永不 resolve —— 若还依赖 refetch，卡片就不会消失
		vi.mocked(deleteFile).mockImplementation(
			() => new Promise(() => {}) as Promise<void>,
		);

		const { default: FileList } = await import("./FileList.tsx");
		const host = document.createElement("div");
		document.body.appendChild(host);

		await createRoot(async (dispose) => {
			render(() => <FileList />, host);
			for (let i = 0; i < 50; i++) {
				await new Promise((r) => setTimeout(r, 20));
				if (host.textContent?.includes("test.png")) break;
			}
			expect(host.textContent).toContain("test.png");

			const listCallsBefore = vi.mocked(listFiles).mock.calls.length;
			const delBtn = [...host.querySelectorAll("button")].find((b) =>
				b.textContent?.includes("删除"),
			);
			expect(delBtn).toBeTruthy();
			delBtn?.click();

			// 只等微任务：卡片应已消失，且没有触发列表重取（乐观更新的关键）
			await new Promise((r) => setTimeout(r, 50));
			expect(host.textContent).not.toContain("test.png");
			expect(vi.mocked(listFiles).mock.calls.length).toBe(listCallsBefore);

			dispose();
		});
	}, 20000);

	it("删除失败时回滚列表", async () => {
		const { listFiles, deleteFile } = await import("@modules/file/api.ts");
		vi.mocked(deleteFile).mockRejectedValue(new Error("boom"));
		// 首次加载返回数据，refetch 也返回同样的数据（回滚后应重新出现）
		vi.mocked(listFiles).mockResolvedValue({
			items: [
				{
					id: 1,
					stored_id: "abc123",
					url: "/api/file/abc123/data/test.png",
					original_name: "test.png",
					mime_type: "image/png",
					file_category: "image",
					size_bytes: 100,
					width: 2,
					height: 2,
					duration_ms: null,
					tags: [],
					created_at: "2026-09-09T13:00:00+00:00",
					updated_at: "2026-09-09T13:00:00+00:00",
					missing: false,
					is_private: false,
					can_edit: true,
				},
			],
			total: 1,
			page: 1,
			page_size: 20,
			total_pages: 1,
		});

		const { default: FileList } = await import("./FileList.tsx");
		const host = document.createElement("div");
		document.body.appendChild(host);

		await createRoot(async (dispose) => {
			render(() => <FileList />, host);
			for (let i = 0; i < 50; i++) {
				await new Promise((r) => setTimeout(r, 20));
				if (host.textContent?.includes("test.png")) break;
			}

			const delBtn = [...host.querySelectorAll("button")].find((b) =>
				b.textContent?.includes("删除"),
			);
			delBtn?.click();
			// 等失败处理与回滚 refetch
			for (let i = 0; i < 50; i++) {
				await new Promise((r) => setTimeout(r, 20));
				if (host.textContent?.includes("test.png")) break;
			}
			expect(host.textContent).toContain("test.png");
			expect(vi.mocked(listFiles).mock.calls.length).toBeGreaterThan(1);

			dispose();
		});
	}, 20000);

	it("内容丢失的文件显示缺失标记且不渲染破图", async () => {
		const { listFiles } = await import("@modules/file/api.ts");
		vi.mocked(listFiles).mockResolvedValueOnce({
			items: [
				{
					id: 9,
					stored_id: "gone12345678",
					url: "/api/file/gone12345678/data/lost.png",
					original_name: "lost.png",
					mime_type: "image/png",
					file_category: "image",
					size_bytes: 10,
					width: 2,
					height: 2,
					duration_ms: null,
					tags: [],
					created_at: "2026-09-09T13:00:00+00:00",
					updated_at: "2026-09-09T13:00:00+00:00",
					missing: true,
					is_private: false,
					can_edit: true,
				},
			],
			total: 1,
			page: 1,
			page_size: 24,
			total_pages: 1,
		});

		const { default: FileList } = await import("./FileList.tsx");
		const host = document.createElement("div");
		document.body.appendChild(host);

		await createRoot(async (dispose) => {
			render(() => <FileList />, host);
			for (let i = 0; i < 50; i++) {
				await new Promise((r) => setTimeout(r, 20));
				if (host.textContent?.includes("文件缺失")) break;
			}
			expect(host.textContent).toContain("文件缺失");
			// 缺失的图片不再渲染 <img>，避免浏览器显示破图
			expect(host.querySelectorAll("img").length).toBe(0);
			dispose();
		});
	}, 20000);

	// 回归：取数失败必须走到错误态。
	// useFileList 原先在 createResource 的 fetcher 里 throw —— 抛错会中断 Solid
	// 的响应式更新，而应用没有 ErrorBoundary，资源停在 loading=true，
	// 页面永远骨架屏，错误文案与重试入口都到不了。
	// 回归：两个上传入口（工具栏按钮、空态 CTA）点的是隐藏的
	// `<input type="file">`。ListPage 迁移时把那个 input 删掉了，而入口写的是
	// `getElementById("file-upload-input")?.click()` —— 可选链把 null 吞掉，
	// 按钮从此静默失效（拖放/粘贴照旧能用，所以更难发现）。
	it("「上传文件」按钮触发隐藏 input（回归：input 被删后按钮静默失效）", async () => {
		const { default: FileList } = await import("./FileList.tsx");
		const host = document.createElement("div");
		document.body.appendChild(host);

		await createRoot(async (dispose) => {
			render(() => <FileList />, host);
			for (let i = 0; i < 50; i++) {
				await new Promise((r) => setTimeout(r, 20));
				if (host.textContent?.includes("上传文件")) break;
			}

			const input = host.querySelector<HTMLInputElement>('input[type="file"]');
			expect(input).toBeTruthy();
			expect(input?.multiple).toBe(true);
			// 隐藏但不能是 disabled：程序化 click() 要能打开选择框
			expect(input?.disabled).toBe(false);

			const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
			const uploadBtn = [...host.querySelectorAll("button")].find((b) =>
				b.textContent?.includes("上传文件"),
			);
			expect(uploadBtn).toBeTruthy();
			uploadBtn?.click();
			expect(clickSpy).toHaveBeenCalledTimes(1);
			clickSpy.mockRestore();

			dispose();
		});
	}, 20000);

	it("取数失败显示错误态而不是卡在骨架屏", async () => {
		const { listFiles } = await import("@modules/file/api.ts");
		vi.mocked(listFiles).mockRejectedValueOnce(new Error("后端不可用"));

		const { default: FileList } = await import("./FileList.tsx");
		const host = document.createElement("div");
		document.body.appendChild(host);

		await createRoot(async (dispose) => {
			render(() => <FileList />, host);
			for (let i = 0; i < 50; i++) {
				await new Promise((r) => setTimeout(r, 20));
				if (host.textContent?.includes("加载失败")) break;
			}
			expect(host.textContent).toContain("加载失败");
			expect(host.textContent).toContain("后端不可用");
			// 骨架屏必须已经让位（否则就是本次修复前的卡死状态）
			expect(host.querySelector('[class*="skeletonListWrap"]')).toBeNull();
			dispose();
		});
	}, 20000);
});
