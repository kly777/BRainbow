// ── 编辑器上传插入格式的回归测试 ──
// 背景：MarkdownEditor 曾调用已删除的 media 模块（上传 404），
// 而该路径当时没有任何测试覆盖，直到手动粘贴图片才暴露。

import { describe, expect, it } from "vitest";
import { buildMarkdownRef } from "./MarkdownEditor.tsx";

describe("buildMarkdownRef", () => {
	it("图片用 Markdown 图片语法", () => {
		expect(
			buildMarkdownRef("image/png", "/api/file/abc/data/a.png", "a.png"),
		).toBe("![](/api/file/abc/data/a.png)");
	});

	it("SVG 也按图片处理", () => {
		expect(
			buildMarkdownRef("image/svg+xml", "/api/file/x/data/i.svg", "i.svg"),
		).toBe("![](/api/file/x/data/i.svg)");
	});

	it("非图片用链接语法（通用文件服务可存任意类型）", () => {
		expect(
			buildMarkdownRef("application/pdf", "/api/file/x/data/r.pdf", "报告.pdf"),
		).toBe("[报告.pdf](/api/file/x/data/r.pdf)");
		expect(
			buildMarkdownRef(
				"application/octet-stream",
				"/api/file/x/data/m.ply",
				"model.ply",
			),
		).toBe("[model.ply](/api/file/x/data/m.ply)");
	});
});
