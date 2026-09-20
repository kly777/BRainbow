// ── 列表侧可预览性判定（纯函数直测） ──

import { describe, expect, it } from "vitest";
import type { FileItem } from "../api.ts";
import {
	canThumb,
	canZoom,
	isRenderableImage,
	preferContain,
	thumbBackdrop,
	thumbSrc,
	thumbSrcSet,
} from "./thumbnail.ts";

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

// ── 服务端缩略图 ──

const THUMB = "/api/file/abcdefgh1234/thumb";
const withThumb = (over: Partial<FileItem> = {}) =>
	item({ thumb_url: THUMB, stored_id: "abcdefgh1234", ...over });

describe("thumbSrc / thumbSrcSet", () => {
	it("有缩略图时按档拼查询串", () => {
		expect(thumbSrc(withThumb(), 320)).toBe(`${THUMB}?w=320`);
	});

	it("没有 thumb_url 时一律 null（调用方退回原图）", () => {
		expect(thumbSrc(item(), 320)).toBeNull();
		expect(thumbSrcSet(item())).toBeNull();
	});

	it("srcset 覆盖阶梯，别报阶梯外的值", () => {
		const set = thumbSrcSet(withThumb());
		expect(set).toBe(
			`${THUMB}?w=160 160w, ${THUMB}?w=320 320w, ${THUMB}?w=640 640w, ${THUMB}?w=1280 1280w`,
		);
		// 列表行的 3rem 格子用不上 640/1280
		expect(thumbSrcSet(withThumb(), [160, 320])).toBe(
			`${THUMB}?w=160 160w, ${THUMB}?w=320 320w`,
		);
	});
});

describe("thumbBackdrop", () => {
	it("用最小档做模糊底衬", () => {
		expect(thumbBackdrop(withThumb())).toBe(`url("${THUMB}?w=160")`);
	});

	it("没有缩略图时没有底衬", () => {
		expect(thumbBackdrop(item())).toBeUndefined();
	});

	it("地址不像后端给的那个形态就不往 style 里插（防注入）", () => {
		for (const bad of [
			"/api/file/abc/thumb", // 不是 12 位
			"/api/file/abcdefgh1234/data/x.png", // 不是 thumb 路由
			'"/api/file/abcdefgh1234/thumb', // 带引号，会破坏 CSS 字符串
			"https://evil.example/thumb",
			"/api/file/../../etc/passwd/thumb",
		]) {
			expect(thumbBackdrop(item({ thumb_url: bad }))).toBeUndefined();
		}
	});
});

describe("preferContain", () => {
	const shaped = (width: number, height: number) =>
		withThumb({ width, height });

	it("竖拍（3:4）与长图（1:5）不裁切", () => {
		expect(preferContain(shaped(3000, 4000))).toBe(true);
		expect(preferContain(shaped(800, 4000))).toBe(true);
	});

	it("接近 16:10 的形状继续 cover（网格整齐更重要）", () => {
		expect(preferContain(shaped(1920, 1080))).toBe(false); // 16:9
		expect(preferContain(shaped(1600, 1000))).toBe(false); // 正好 16:10
		expect(preferContain(shaped(1200, 900))).toBe(false); // 4:3
	});

	it("尺寸未知时不动（保持默认 cover）", () => {
		expect(preferContain(withThumb({ width: null, height: null }))).toBe(false);
	});
});
