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

describe("FileList 渲染", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
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
});
