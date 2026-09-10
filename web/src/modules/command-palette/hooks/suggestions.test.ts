// ── 全局搜索目标的 URL 解析与模块标签 ──

import { fillPath, PATHS } from "@config/paths";
import { describe, expect, it } from "vitest";
import { KIND_LABEL, resolveTargetUrl } from "./suggestions.ts";

describe("resolveTargetUrl", () => {
	it("File 目标解析为文件详情页", () => {
		expect(resolveTargetUrl({ type: "File", params: { id: 42 } })).toBe(
			fillPath(PATHS.fileDetail, 42),
		);
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
