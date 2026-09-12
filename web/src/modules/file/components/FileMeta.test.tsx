// ── FileMeta：卡片内的文件信息区（常驻展示，不依赖 hover） ──

import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import type { FileItem } from "../api.ts";
import FileMeta from "./FileMeta.tsx";

function makeItem(overrides: Partial<FileItem> = {}): FileItem {
	return {
		id: 1,
		stored_id: "abc123",
		url: "/api/file/abc123/data/a.png",
		original_name: "a.png",
		mime_type: "image/png",
		file_category: "image",
		size_bytes: 2048,
		width: 1920,
		height: 1080,
		duration_ms: null,
		tags: [],
		created_at: "2026-09-09T13:00:00+00:00",
		updated_at: "2026-09-09T13:00:00+00:00",
		missing: false,
		...overrides,
	};
}

/** 渲染信息区并取回文本内容 */
function metaText(item: FileItem): string {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const dispose = render(() => <FileMeta item={item} />, host);
	const text = host.textContent ?? "";
	dispose();
	host.remove();
	return text;
}

describe("FileMeta", () => {
	it("展示中文分类、大小与像素尺寸", () => {
		const text = metaText(makeItem());
		expect(text).toContain("图片");
		expect(text).toContain("2.0 KB");
		expect(text).toContain("1920 × 1080");
	});

	it("视频展示时长", () => {
		const text = metaText(
			makeItem({
				file_category: "video",
				mime_type: "video/mp4",
				duration_ms: 125_000,
			}),
		);
		expect(text).toContain("视频");
		expect(text).toContain("2:05");
	});

	it("无宽高的文档不展示尺寸与时长", () => {
		const text = metaText(
			makeItem({
				file_category: "document",
				mime_type: "application/pdf",
				width: null,
				height: null,
			}),
		);
		expect(text).toContain("文档");
		expect(text).not.toContain("×");
	});

	it("展示上传时间", () => {
		expect(metaText(makeItem())).toContain("上传于");
	});
});
