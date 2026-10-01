// ── 全局搜索目标的 URL 解析、模块标签、导航候选 ──

import { fillPath, isConcretePath, PATHS } from "@config/paths";
import { describe, expect, it } from "vitest";
import { buildNavItems, KIND_LABEL, resolveTargetUrl } from "./suggestions.ts";

describe("resolveTargetUrl", () => {
	it("File 目标用 stored_id 解析为文件详情页", () => {
		expect(
			resolveTargetUrl({ type: "File", params: { stored_id: "abc123" } }),
		).toBe(fillPath(PATHS.fileDetail, "abc123"));
		// 回归：不能把数据库数字主键拼进路由（详情页参数是 stored_id）
		expect(
			resolveTargetUrl({ type: "File", params: { stored_id: "abc123" } }),
		).toBe("/file/abc123");
	});

	it("既有模块解析不受影响", () => {
		expect(resolveTargetUrl({ type: "Task", params: { id: 7 } })).toBe(
			fillPath(PATHS.taskDetail, 7),
		);
		expect(resolveTargetUrl({ type: "Text", params: {} })).toBe(PATHS.text);
		expect(
			resolveTargetUrl({
				type: "ChatNode",
				params: { tree_id: 3, node_id: 9 },
			}),
		).toBe(`${PATHS.chat}?tree=3&node=9`);
	});

	it("未知类型回退到首页", () => {
		// biome-ignore lint/suspicious/noExplicitAny: 模拟后端新增类型而前端未更新
		const unknown = { type: "Nope", params: {} } as any;
		expect(resolveTargetUrl(unknown)).toBe(PATHS.home);
	});
});

describe("KIND_LABEL", () => {
	it("文件模块有中文标签", () => {
		expect(KIND_LABEL.file).toBe("文件");
		expect(KIND_LABEL.card).toBe("卡片");
	});
});

describe("buildNavItems（/ 模式的候选）", () => {
	const noop = () => {};

	/** 候选项的路径都在 extra 里（导航建议必带 extra） */
	const pathsOf = (q: string) =>
		buildNavItems(q, noop, noop)
			.map((s) => s.extra)
			.filter((p): p is string => typeof p === "string");

	it("搜索时不把带参数的模板路径当候选（跳过去是坏页面）", () => {
		// "file" 会命中「文件」这个页面，也会命中 /file/:id 模板（此前就是这么漏出来的）
		const hits = pathsOf("file");
		expect(hits).toContain(PATHS.file);
		expect(hits).not.toContain(PATHS.fileDetail);

		// 任何查询、任何一条候选都必须是可直接跳转的实路径
		for (const q of ["file", "card", "edit", "detail", "reading", "id"]) {
			for (const path of pathsOf(q)) {
				expect(isConcretePath(path), `q=${q} 给出了模板路径 ${path}`).toBe(
					true,
				);
			}
		}
	});

	it("nav:false 的**实路径**页面仍可搜到（add / manage 这类管理页）", () => {
		const hits = pathsOf("add");
		expect(hits).toContain(PATHS.cardAdd);
		expect(hits).toContain(PATHS.memoryAdd);
	});

	it("空查询列出导航页（不含模板）", () => {
		const paths = pathsOf("");
		expect(paths).toContain(PATHS.file);
		expect(paths.every(isConcretePath)).toBe(true);
	});
});
