// ── 列表侧可预览性判定（纯函数直测） ──

import { describe, expect, it } from "vitest";
import type { FileItem } from "../api.ts";
import { canThumb, canZoom, isRenderableImage } from "./thumbnail.ts";

const item = (over: Partial<FileItem> = {}): FileItem => ({
	id: 1,
	stored_id: "s1",
	url: "/api/file/s1/data/a.png",
	original_name: "a.png",
	mime_type: "image/png",
	file_category: "image",
	size_bytes: 1024,
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

describe("isRenderableImage", () => {
	it("浏览器能渲染的位图与 SVG", () => {
		for (const mime of [
			"image/png",
			"image/jpeg",
			"image/gif",
			"image/webp",
			"image/bmp",
			"image/svg+xml",
		])
			expect(isRenderableImage(mime)).toBe(true);
	});

	it("TIFF 与视频/文档不算（TIFF 只有 Safari 能渲染）", () => {
		expect(isRenderableImage("image/tiff")).toBe(false);
		expect(isRenderableImage("video/mp4")).toBe(false);
		expect(isRenderableImage("application/pdf")).toBe(false);
		expect(isRenderableImage("text/plain")).toBe(false);
	});
});

describe("canThumb", () => {
	it("普通图片可做缩略图", () => {
		expect(canThumb(item())).toBe(true);
	});

	it("私密图片不可（<img> 不带凭据会 401）", () => {
		expect(canThumb(item({ is_private: true }))).toBe(false);
	});

	it("内容缺失不可", () => {
		expect(canThumb(item({ missing: true }))).toBe(false);
	});

	it("TIFF 不可（列表里没有失败兜底位置）", () => {
		expect(canThumb(item({ mime_type: "image/tiff" }))).toBe(false);
	});
});

describe("canZoom", () => {
	it("私密图片可放大（灯箱会换 blob）", () => {
		expect(canZoom(item({ is_private: true }))).toBe(true);
	});

	it("缺失文件与 TIFF 不可放大", () => {
		expect(canZoom(item({ missing: true }))).toBe(false);
		expect(canZoom(item({ mime_type: "image/tiff" }))).toBe(false);
	});
});
