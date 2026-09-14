// ── FileThumb：列表里"什么文件显示什么"的降级链 ──
// 判定逻辑在 lib/thumbnail.ts（纯函数直测），这里锁渲染结果与降级行为。

import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import type { FileItem } from "../api.ts";
import { FileThumb } from "./FileThumb.tsx";

const item = (over: Partial<FileItem> = {}): FileItem => ({
	id: 1,
	stored_id: "abc123",
	url: "/api/file/abc123/data/照片.png",
	original_name: "照片.png",
	mime_type: "image/png",
	file_category: "image",
	size_bytes: 2048,
	width: null,
	height: null,
	duration_ms: null,
	tags: [],
	meta: {},
	created_at: "2026-09-14T00:00:00+00:00",
	updated_at: "2026-09-14T00:00:00+00:00",
	missing: false,
	is_private: false,
	can_edit: true,
	...over,
});

function mount(file: FileItem) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <FileThumb item={file} imgClass="thumb" />, host);
	return host;
}

describe("FileThumb", () => {
	it("可渲染的图片直接给 <img>", () => {
		const host = mount(item());
		expect(host.querySelector("img")?.getAttribute("src")).toBe(
			"/api/file/abc123/data/照片.png",
		);
	});

	it("TIFF 不给 <img>（列表里没有加载失败的兜底位置），改后缀徽章", () => {
		const host = mount(
			item({ mime_type: "image/tiff", original_name: "扫描件.tiff" }),
		);
		expect(host.querySelector("img")).toBeNull();
		expect(host.textContent).toContain("TIFF");
	});

	it("私密文件不给 <img>（不带凭据会 401）", () => {
		const host = mount(item({ is_private: true }));
		expect(host.querySelector("img")).toBeNull();
		expect(host.textContent).toContain("私密");
	});

	it("缺失文件给缺失徽章", () => {
		const host = mount(item({ missing: true }));
		expect(host.textContent).toContain("文件缺失");
	});

	it("图片加载失败时降级成后缀徽章", async () => {
		const host = mount(item({ original_name: "坏图.png" }));
		host.querySelector("img")?.dispatchEvent(new Event("error"));
		await new Promise((r) => setTimeout(r, 0));
		expect(host.querySelector("img")).toBeNull();
		expect(host.textContent).toContain("PNG");
	});
});
