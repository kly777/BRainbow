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

// ── 类型底色 / 淡入 / 时长角标 ──

/** 找承载底色的那一层（色相走 CSS 变量，只在非图片文件上出现） */
function tintHost(host: HTMLElement) {
	return [...host.querySelectorAll<HTMLElement>("[style]")].find((el) =>
		el.style.getPropertyValue("--thumb-hue"),
	);
}

const doc = () =>
	item({
		original_name: "报告.pdf",
		mime_type: "application/pdf",
		file_category: "document",
	});

describe("FileThumb 的类型底色", () => {
	it("非图片文件带上按类型算出的色相", () => {
		const host = mount(doc());
		expect(tintHost(host)?.style.getPropertyValue("--thumb-hue")).toBe("262");
	});

	it("图片不带底色（它有真缩略图）", () => {
		expect(tintHost(mount(item()))).toBeUndefined();
	});

	it("缺失文件不带底色", () => {
		expect(tintHost(mount(item({ ...doc(), missing: true })))).toBeUndefined();
	});
});

describe("FileThumb 的缩略图淡入", () => {
	// vitest 不处理 CSS（css: false），`styles.fadeImg` 一律是 `_<key>_<hash>`，
	// 所以按这个既定形态断言（见 shared/styles/css-modules-contract.test.ts 的说明）
	it("加载完成前不显影，加载后显影", async () => {
		const host = mount(item());
		const img = host.querySelector("img");
		expect(img?.className).toContain("_fadeImg_");
		expect(img?.className).not.toContain("_fadeImgIn_");

		img?.dispatchEvent(new Event("load"));
		await new Promise((r) => setTimeout(r, 0));
		expect(host.querySelector("img")?.className).toContain("_fadeImgIn_");
	});
});

describe("FileThumb 的时长角标", () => {
	const clip = (over: Partial<FileItem> = {}) =>
		item({
			original_name: "片段.mp4",
			mime_type: "video/mp4",
			file_category: "video",
			duration_ms: 125_000,
			...over,
		});

	it("开了角标且有时长时显示", () => {
		document.body.innerHTML = "";
		const host = document.createElement("div");
		document.body.appendChild(host);
		render(
			() => <FileThumb item={clip()} imgClass="thumb" durationBadge />,
			host,
		);
		expect(host.textContent).toContain("2:05");
	});

	it("没开角标（列表行的 3rem 格子）就不显示", () => {
		expect(mount(clip()).textContent).not.toContain("2:05");
	});

	it("没有时长的视频不显示空角标", () => {
		document.body.innerHTML = "";
		const host = document.createElement("div");
		document.body.appendChild(host);
		render(
			() => (
				<FileThumb
					item={clip({ duration_ms: null })}
					imgClass="thumb"
					durationBadge
				/>
			),
			host,
		);
		expect(host.textContent).not.toContain(":");
	});
});

describe("FileThumb 用服务端缩略图", () => {
	const THUMB = "/api/file/abcdefgh1234/thumb";
	const thumbed = (over: Partial<FileItem> = {}) =>
		item({ thumb_url: THUMB, stored_id: "abcdefgh1234", ...over });

	it("有 thumb_url 时 src 走缩略图，并带上 srcset/sizes", () => {
		const host = mount(thumbed({ width: 1600, height: 1000 }));
		const img = host.querySelector("img");
		// src 取中间档（老浏览器兜底），不是原图
		expect(img?.getAttribute("src")).toBe(`${THUMB}?w=320`);
		expect(img?.getAttribute("srcset")).toContain(`${THUMB}?w=640 640w`);
		expect(img?.getAttribute("sizes")).toBe("260px");
	});

	it("没有 thumb_url 时退回原图，且不带 srcset", () => {
		const host = mount(item());
		const img = host.querySelector("img");
		expect(img?.getAttribute("src")).toBe("/api/file/abc123/data/照片.png");
		expect(img?.getAttribute("srcset")).toBeNull();
	});

	it("竖图改 contain 并亮出模糊底衬（不然是一块空框）", () => {
		const host = mount(thumbed({ width: 3000, height: 4000 }));
		expect(host.querySelector("img")?.className).toContain("_imgContain_");
		const backdrop = host.querySelector<HTMLElement>(
			'[style*="background-image"]',
		);
		expect(backdrop?.style.backgroundImage).toContain(`${THUMB}?w=160`);
	});

	it("接近 16:10 的图维持 cover，也不为底衬多发请求", () => {
		const host = mount(thumbed({ width: 1600, height: 1000 }));
		expect(host.querySelector("img")?.className).toContain("_imgCover_");
		expect(host.querySelector('[style*="background-image"]')).toBeNull();
	});
});
