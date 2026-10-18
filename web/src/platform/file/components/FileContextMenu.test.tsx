// ── FileContextMenu 渲染测试 ──
// 菜单的写操作（重命名 / 删除）只对 `can_edit` 的文件出现：
// 别人的公开文件也能右键打开菜单，但按钮不该给出"点了会 404"的入口。
// 读操作（查看详情 / 复制链接 / 下载）对谁都出现。

import { render } from "solid-js/web";
import { describe, expect, it } from "vite-plus/test";
import type { FileItem } from "../api.ts";
import FileContextMenu from "./FileContextMenu.tsx";

const item = (over: Partial<FileItem> = {}): FileItem => ({
	id: 1,
	stored_id: "abc123",
	url: "/api/file/abc123/data/照片.png",
	original_name: "照片.png",
	mime_type: "image/png",
	file_category: "image",
	size_bytes: 2048,
	width: 800,
	height: 600,
	duration_ms: null,
	tags: [],
	meta: {},
	created_at: "2026-09-09T13:00:00+00:00",
	updated_at: "2026-09-09T13:00:00+00:00",
	missing: false,
	is_private: false,
	can_edit: true,
	...over,
});

function mount(file: FileItem) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(
		() => (
			<FileContextMenu
				item={file}
				x={10}
				y={10}
				onClose={() => {}}
				onOpenDetail={() => {}}
				onStartRename={() => {}}
				onDelete={() => {}}
			/>
		),
		host,
	);
	return document.body;
}

describe("FileContextMenu", () => {
	it("可编辑的文件：读操作与写操作都在", () => {
		const text = mount(item()).textContent ?? "";
		expect(text).toContain("查看详情");
		expect(text).toContain("复制链接");
		expect(text).toContain("下载");
		expect(text).toContain("重命名");
		expect(text).toContain("删除");
	});

	it("不可编辑的文件（别人的公开文件）：只留读操作", () => {
		const text = mount(item({ can_edit: false })).textContent ?? "";
		expect(text).toContain("查看详情");
		expect(text).toContain("复制链接");
		expect(text).toContain("下载");
		expect(text).not.toContain("重命名");
		expect(text).not.toContain("删除");
	});
});
