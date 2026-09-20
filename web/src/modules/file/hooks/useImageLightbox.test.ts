// ── 图片灯箱索引的契约测试 ──
// 索引用 `-1 = 未打开` 表达（页面据此决定是否渲染灯箱），翻页范围是"当前页里
// 可放大的那些"（判定与卡片/列表行共用 canZoom）。

import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import type { FileItem } from "../api.ts";
import { useImageLightbox } from "./useImageLightbox.ts";

const file = (id: string, over: Partial<FileItem> = {}) =>
	({
		id: 1,
		stored_id: id,
		url: `/api/file/${id}/data/x.png`,
		original_name: `${id}.png`,
		mime_type: "image/png",
		file_category: "image",
		size_bytes: 1024,
		width: 100,
		height: 100,
		duration_ms: null,
		tags: [],
		meta: {},
		created_at: "2026-09-01T10:00:00+00:00",
		updated_at: "2026-09-01T10:00:00+00:00",
		missing: false,
		is_private: false,
		can_edit: true,
		...over,
	}) as FileItem;

function setup(items: () => readonly FileItem[]) {
	let api!: ReturnType<typeof useImageLightbox>;
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => {
		api = useImageLightbox(items);
		return null;
	}, host);
	return api;
}

describe("useImageLightbox", () => {
	it("未打开时 index 为 -1", () => {
		const api = setup(() => [file("a")]);
		expect(api.index()).toBe(-1);
	});

	it("打开后 index 指向该图在可放大项里的位置", () => {
		const api = setup(() => [file("a"), file("b"), file("c")]);
		api.open(file("b"));
		expect(api.index()).toBe(1);
	});

	it("翻页按可放大列表移动，越界忽略", () => {
		const api = setup(() => [file("a"), file("b")]);
		api.open(file("a"));
		api.navigate(1);
		expect(api.index()).toBe(1);
		// 越界不改状态
		api.navigate(5);
		expect(api.index()).toBe(1);
		api.navigate(-1);
		expect(api.index()).toBe(1);
	});

	it("不可放大的文件不进灯箱范围", () => {
		// 缺失的文件不能放大（canZoom 的判定）
		const api = setup(() => [file("a", { missing: true }), file("b")]);
		expect(api.items().map((i) => i.stored_id)).toEqual(["b"]);
		api.open(file("b"));
		expect(api.index()).toBe(0);
	});

	it("关闭后回到 -1", () => {
		const api = setup(() => [file("a")]);
		api.open(file("a"));
		api.close();
		expect(api.index()).toBe(-1);
	});
});
