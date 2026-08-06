/**
 * speech 工具单元测试（stripMarkdown / containsCjk 纯函数）
 */
import { describe, expect, it } from "vitest";
import { containsCjk, stripMarkdown } from "./speech.ts";

describe("stripMarkdown", () => {
	it("去掉标题标记", () => {
		expect(stripMarkdown("## 什么是原子")).toBe("什么是原子");
	});

	it("去掉粗体和斜体", () => {
		expect(stripMarkdown("**重要**内容")).toBe("重要内容");
		expect(stripMarkdown("_斜体_ 和 *斜体*")).toBe("斜体 和 斜体");
	});

	it("保留链接文字，去掉 URL", () => {
		expect(stripMarkdown("[Rust 官网](https://rust-lang.org)")).toBe(
			"Rust 官网",
		);
	});

	it("图片取 alt 文本", () => {
		expect(stripMarkdown("![架构图](./arch.png)")).toBe("架构图");
	});

	it("行内代码去掉反引号", () => {
		expect(stripMarkdown("使用 `flatMap` 组合")).toBe("使用 flatMap 组合");
	});

	it("列表去掉标记保留文本", () => {
		expect(stripMarkdown("- 第一项\n- 第二项")).toBe("第一项，第二项");
		expect(stripMarkdown("1. 第一步\n2. 第二步")).toBe("第一步，第二步");
	});

	it("引用去掉 > 标记", () => {
		expect(stripMarkdown("> 引用内容")).toBe("引用内容");
	});

	it("分隔线变为空", () => {
		expect(stripMarkdown("正文\n---\n后文")).toBe("正文，后文");
	});

	it("表格转空格并合并行", () => {
		const table = "| 词 | 义 |\n|---|---|\n| 原子 | atom |";
		const out = stripMarkdown(table);
		expect(out).toContain("词");
		expect(out).toContain("原子");
	});

	it("HTML 标签被移除", () => {
		expect(stripMarkdown("<div>你好</div>")).toBe("你好");
	});

	it("删除线移除标记但保留文字", () => {
		expect(stripMarkdown("~~过时~~内容")).toBe("过时内容");
	});

	it("合并空行和行首缩进", () => {
		expect(stripMarkdown("  第一行\n\n  第二行")).toBe("第一行，第二行");
	});

	it("纯文本原样保留", () => {
		expect(stripMarkdown("hello world")).toBe("hello world");
	});

	it("空文本返回空", () => {
		expect(stripMarkdown("")).toBe("");
		expect(stripMarkdown("   \n  ")).toBe("");
	});
});

describe("containsCjk", () => {
	it("中文返回 true", () => {
		expect(containsCjk("你好世界")).toBe(true);
	});

	it("英文返回 false", () => {
		expect(containsCjk("hello world")).toBe(false);
	});

	it("混合文本返回 true", () => {
		expect(containsCjk("Rust 的 ownership")).toBe(true);
	});
});
