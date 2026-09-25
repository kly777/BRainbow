import { describe, expect, it } from "vitest";
import { highlightKeywords } from "./highlight.ts";

describe("highlightKeywords", () => {
	it("空查询或空文本 → 空串（不渲染残留）", () => {
		expect(highlightKeywords("hello", "")).toBe("");
		expect(highlightKeywords("", "hello")).toBe("");
	});

	it("纯空白查询 → 返回转义后的原文，只是不加标记", () => {
		expect(highlightKeywords("hello", "   ")).toBe("hello");
		expect(highlightKeywords("a & b", "  ")).toBe("a &amp; b");
	});

	it("命中词包 <mark>，大小写不敏感但保留原文大小写", () => {
		expect(highlightKeywords("Hello world", "hello")).toBe(
			"<mark>Hello</mark> world",
		);
	});

	it("多个查询词各自高亮（按空白切分）", () => {
		expect(highlightKeywords("foo bar baz", "foo baz")).toBe(
			"<mark>foo</mark> bar <mark>baz</mark>",
		);
	});

	it("同一词多次出现全部高亮", () => {
		expect(highlightKeywords("a cat and a cat", "cat")).toBe(
			"a <mark>cat</mark> and a <mark>cat</mark>",
		);
	});

	it("先转义 HTML 再插标记（内容里的标签不会被当标记渲染）", () => {
		expect(highlightKeywords("<script>x</script>", "script")).toBe(
			"&lt;<mark>script</mark>&gt;x&lt;/<mark>script</mark>&gt;",
		);
		expect(highlightKeywords("a & b", "b")).toBe("a &amp; <mark>b</mark>");
	});

	it("查询词里的正则元字符按字面匹配", () => {
		expect(highlightKeywords("a.b axb", "a.b")).toBe("<mark>a.b</mark> axb");
		expect(highlightKeywords("f(x) + (y)", "(x)")).toBe(
			"f<mark>(x)</mark> + (y)",
		);
	});
});
