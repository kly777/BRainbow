// ── FileInfoTip：hover 文件名时的信息卡内容 ──

import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import type { FileItem } from "../api.ts";
import FileInfoTip, { fmtDuration } from "./FileInfoTip.tsx";

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
		...overrides,
	};
}

/** 渲染信息卡并取回文本内容 */
function tipText(item: FileItem): string {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const dispose = render(() => <FileInfoTip item={item} />, host);
	const text = host.textContent ?? "";
	dispose();
	host.remove();
	return text;
}

describe("FileInfoTip", () => {
	it("展示完整文件名、中文分类、MIME、大小与像素尺寸", () => {
		const text = tipText(makeItem({ original_name: "很长的文件名称示例.png" }));
		expect(text).toContain("很长的文件名称示例.png");
		expect(text).toContain("图片");
		expect(text).toContain("image/png");
		expect(text).toContain("2.0 KB");
		expect(text).toContain("1920 × 1080");
	});

	it("视频展示时长", () => {
		const text = tipText(
			makeItem({
				file_category: "video",
				mime_type: "video/mp4",
				duration_ms: 125_000,
			}),
		);
		expect(text).toContain("视频");
		expect(text).toContain("时长 2:05");
	});

	it("无宽高（文档类）时不展示尺寸", () => {
		const text = tipText(
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

	it("有标签时列出标签，无标签时不出现井号", () => {
		expect(tipText(makeItem({ tags: ["设计", "参考"] }))).toContain(
			"#设计 #参考",
		);
		expect(tipText(makeItem())).not.toContain("#");
	});

	it("展示上传时间", () => {
		expect(tipText(makeItem())).toContain("上传于");
	});
});

describe("fmtDuration", () => {
	it("不足一分钟补零到 0:ss", () => {
		expect(fmtDuration(3_000)).toBe("0:03");
	});

	it("分钟级为 m:ss", () => {
		expect(fmtDuration(125_000)).toBe("2:05");
	});

	it("小时级为 h:mm:ss", () => {
		expect(fmtDuration(3_725_000)).toBe("1:02:05");
	});
});
