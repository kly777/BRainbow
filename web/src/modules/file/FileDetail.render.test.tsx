// ── FileDetail 渲染回归 ──
// 本页做过两处结构性改动，这组断言就是为它们兜底：
//   1. 迁到 `DetailPage` 外壳 —— 返回栏由外壳提供，h1 走 `titleHidden`（sr-only，
//      因为返回栏已展示文件名，可见标题重复没有意义）；
//   2. 编辑表单改用 `Field` + `Input` —— label 关联与 id 由原语生成。

import { getFile } from "@modules/file/api.ts";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FileDetailPage from "./FileDetail.tsx";

vi.mock("@modules/file/api.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@modules/file/api.ts")>();
	return {
		...actual,
		getFile: vi.fn(),
		listFiles: vi.fn().mockResolvedValue({
			items: [],
			page: 1,
			page_size: 20,
			total: 0,
			total_pages: 0,
		}),
		updateFile: vi.fn().mockResolvedValue(undefined),
		deleteFile: vi.fn().mockResolvedValue(undefined),
		listFileTags: vi.fn().mockResolvedValue([]),
	};
});

vi.mock("@solidjs/router", () => ({
	useNavigate: () => vi.fn(),
	useParams: () => ({ id: "abc123" }),
	useLocation: () => ({ pathname: "/file/abc123", search: "", state: null }),
}));

vi.mock("@shared/utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@shared/utils")>();
	return {
		...actual,
		copyTextWithToast: vi.fn(),
		notifySuccess: vi.fn(),
		notifyError: vi.fn(),
		showConfirm: vi.fn().mockResolvedValue(true),
	};
});

const mockedGetFile = vi.mocked(getFile);

const file = {
	id: 1,
	stored_id: "abc123",
	url: "/api/file/abc123/data/报告.pdf",
	original_name: "报告.pdf",
	mime_type: "application/pdf",
	file_category: "document" as const,
	size_bytes: 2048,
	width: null,
	height: null,
	duration_ms: null,
	tags: ["工作"],
	meta: { 作者: "我" },
	created_at: "2026-09-09T13:00:00+00:00",
	updated_at: "2026-09-09T13:00:00+00:00",
	missing: false,
	is_private: false,
	can_edit: true,
};

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <FileDetailPage />, host);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedGetFile.mockResolvedValue(file as never);
});

describe("FileDetail：DetailPage 迁移后的回归", () => {
	it("渲染唯一的 h1，且为 sr-only（返回栏已展示文件名）", async () => {
		const host = mount();
		await settle(() => host.querySelector("h1")?.textContent === "报告.pdf");
		const h1 = host.querySelectorAll("h1");
		expect(h1.length).toBe(1);
		expect(h1[0].textContent).toBe("报告.pdf");
		expect(h1[0].className).toContain("sr-only");
	});

	it("返回栏与动作区由外壳提供", async () => {
		const host = mount();
		await flush();
		expect(host.textContent).toContain("文件列表");
		expect(host.textContent).toContain("编辑");
		expect(host.textContent).toContain("删除");
	});

	it("加载完成后渲染文件信息", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("报告.pdf"));
		expect(host.textContent).toContain("报告.pdf");
		expect(host.textContent).toContain("工作");
	});

	it("加载失败显示错误态而不是卡在骨架屏", async () => {
		mockedGetFile.mockRejectedValue(new Error("文件接口不可用"));
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("文件接口不可用"));
		expect(mockedGetFile).toHaveBeenCalled();
		expect(host.textContent).toContain("文件接口不可用");
		expect(host.textContent).toContain("重试");
	});

	it("编辑态：文件名走 Field + Input，label 的 for 指向 input 的 id", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("编辑"));

		const editBtn = Array.from(host.querySelectorAll("button")).find(
			(b) => b.textContent?.trim() === "编辑",
		);
		editBtn?.click();
		await flush();

		const label = Array.from(host.querySelectorAll("label")).find(
			(l) => l.textContent?.trim() === "文件名",
		);
		expect(label).toBeTruthy();
		// 原语生成 id 并自动关联：这张断言就是 P1-4 之后新增的 Field 契约
		expect(label?.getAttribute("for")).toBeTruthy();
		const input = host.querySelector("input");
		expect(input?.id).toBe(label?.getAttribute("for"));
	});
});
