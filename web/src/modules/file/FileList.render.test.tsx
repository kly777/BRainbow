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
				},
			],
			total: 1,
			page: 1,
			page_size: 20,
			total_pages: 1,
		}),
		listFileTags: vi.fn().mockResolvedValue([]),
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
});
