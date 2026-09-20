// ── FilePickerModal 渲染测试 ──
// 空态刚从"页面自己的 <p> + 自己的 CSS"换成共享 EmptyState，断言锁住这条：
// 没有可插入的文件时给得出提示，有文件时给的是列表而不是空态。

import { listFiles } from "@modules/file/api.ts";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FilePickerModal from "./FilePickerModal.tsx";

vi.mock("@modules/file/api.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@modules/file/api.ts")>();
	return { ...actual, listFiles: vi.fn() };
});

const mockedList = vi.mocked(listFiles);

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function file(over: Record<string, unknown> = {}) {
	return {
		id: 1,
		stored_id: "abc",
		url: "/api/file/abc/data/图.png",
		original_name: "图.png",
		mime_type: "image/png",
		file_category: "image",
		size_bytes: 1024,
		width: 10,
		height: 10,
		duration_ms: null,
		tags: [],
		meta: {},
		created_at: "2026-09-01T10:00:00+00:00",
		updated_at: "2026-09-01T10:00:00+00:00",
		missing: false,
		is_private: false,
		can_edit: true,
		...over,
	};
}

// Modal 用 Portal 渲染到 document.body，所以断言看 document.body 而不是挂载点
function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(
		() => <FilePickerModal isOpen onClose={() => {}} onPick={() => {}} />,
		host,
	);
	return document.body;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("FilePickerModal", () => {
	it("没有可插入的文件时给出空态提示", async () => {
		mockedList.mockResolvedValue({ items: [] } as never);
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("没有匹配的文件"));

		expect(host.textContent).toContain("从文件库插入");
		expect(host.textContent).toContain("没有匹配的文件");
	});

	it("有文件时列出文件名而不是空态", async () => {
		mockedList.mockResolvedValue({
			items: [
				file(),
				file({ id: 2, stored_id: "def", original_name: "文档.pdf" }),
			],
		} as never);
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("图.png"));

		expect(host.textContent).toContain("图.png");
		expect(host.textContent).toContain("文档.pdf");
		expect(host.textContent).not.toContain("没有匹配的文件");
	});

	// 选择器此前自己写了一版缩略图（只看 mime 就渲染 <img>）：私密文件会 401、缺失文件是破图。
	// 现在与列表共用 FileThumb，这条锁住回归。
	it("私密与缺失文件不渲染 <img>", async () => {
		mockedList.mockResolvedValue({
			items: [
				file(),
				file({ id: 2, stored_id: "sec", is_private: true }),
				file({ id: 3, stored_id: "gone", missing: true }),
			],
		} as never);
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("图.png"));

		expect(host.querySelectorAll("img").length).toBe(1);
		expect(host.textContent).toContain("缺失");
	});
});
