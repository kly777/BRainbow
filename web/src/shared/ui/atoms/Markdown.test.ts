// @vitest-environment jsdom

import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import markedKatex from "marked-katex-extension";
import { beforeAll, describe, expect, it } from "vitest";

// ── 配置（与 Markdown.tsx 保持一致） ──

beforeAll(() => {
	DOMPurify.addHook("afterSanitizeAttributes", (node) => {
		if (node instanceof HTMLAnchorElement) {
			node.setAttribute("target", "_blank");
			node.setAttribute("rel", "noopener noreferrer");
		}
	});

	marked.use(
		markedHighlight({
			langPrefix: "hljs language-",
			highlight(code, lang) {
				if (lang && hljs.getLanguage(lang)) {
					return hljs.highlight(code, { language: lang }).value;
				}
				return code;
			},
		}),
		markedKatex({
			throwOnError: false,
			nonStandard: true,
		}),
	);
	marked.setOptions({ gfm: true, breaks: true });
});

const ALLOWED_TAGS = [
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"br",
	"hr",
	"strong",
	"em",
	"b",
	"i",
	"u",
	"s",
	"blockquote",
	"code",
	"pre",
	"ul",
	"ol",
	"li",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"a",
	"img",
	"div",
	"span",
	"math",
	"semantics",
	"mrow",
	"mfrac",
	"mi",
	"mo",
	"msup",
	"msub",
	"mn",
	"mtext",
	"mspace",
	"msqrt",
	"mroot",
	"mover",
	"munder",
	"munderover",
	"mtable",
	"mtr",
	"mtd",
	"mpadded",
	"mphantom",
	"annotation",
	"svg",
	"path",
];

const ALLOWED_ATTR = [
	"href",
	"target",
	"rel",
	"title",
	"src",
	"alt",
	"width",
	"height",
	"class",
	"id",
	"align",
	"style",
	"aria-hidden",
	"encoding",
	"xmlns",
	"d",
	"viewBox",
	"fill",
	"stroke",
	"preserveAspectRatio",
];

// ── 渲染辅助（与 Markdown.tsx 组件逻辑一致） ──

function render(content: string, inline = false): string {
	let processed = content;
	if (inline) processed = processed.replace(/\n/g, " ");

	processed = processed
		.replace(/\\\(/g, "$")
		.replace(/\\\)/g, "$")
		.replace(/\\\[/g, "$$$$")
		.replace(/\\\]/g, "$$$$");

	const rawHtml = marked.parse(processed) as string;

	return DOMPurify.sanitize(rawHtml, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		ALLOWED_URI_REGEXP:
			/^(?:(?:https?|mailto|ftp|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
	});
}

// ── 测试 ──

describe("Markdown rendering pipeline", () => {
	// ========== 基础 Markdown ==========

	describe("plain markdown", () => {
		it("renders heading", () => {
			const html = render("# Hello");
			expect(html).toContain("<h1");
			expect(html).toContain("Hello");
		});

		it("renders paragraph", () => {
			const html = render("a paragraph");
			expect(html).toContain("<p>");
			expect(html).toContain("a paragraph");
		});

		it("renders bold and italic", () => {
			const html = render("**bold** *italic*");
			expect(html).toContain("<strong>bold</strong>");
			expect(html).toContain("<em>italic</em>");
		});

		it("renders code block with syntax highlight", () => {
			const html = render("```ts\nconst x: number = 1\n```");
			expect(html).toContain("<pre>");
			expect(html).toContain("<code");
			// highlight.js 把代码拆成高亮 span
			expect(html).toContain('class="hljs language-ts"');
			expect(html).toContain("<span");
			expect(html).toContain("const");
		});

		it("renders inline code", () => {
			const html = render("use `code` here");
			expect(html).toContain("<code>code</code>");
		});

		it("renders unordered list", () => {
			const html = render("- item 1\n- item 2");
			expect(html).toContain("<ul>");
			expect(html).toContain("<li>item 1");
			expect(html).toContain("<li>item 2");
		});

		it("renders link with target=_blank", () => {
			const html = render("[click](https://example.com)");
			expect(html).toContain('href="https://example.com"');
			expect(html).toContain('target="_blank"');
			expect(html).toContain('rel="noopener noreferrer"');
		});
	});

	// ========== 安全过滤 ==========

	describe("DOMPurify sanitization", () => {
		it("strips script tags", () => {
			const html = render('<script>alert("xss")</script>');
			expect(html).not.toContain("<script>");
			expect(html).not.toContain("alert");
		});

		it("strips event handlers", () => {
			const html = render('<img onerror="alert(1)" src=x>');
			expect(html).not.toContain("onerror");
		});

		it("allows safe img tags", () => {
			const html = render("![alt](https://example.com/img.png)");
			expect(html).toContain("<img");
			expect(html).toContain('src="https://example.com/img.png"');
			expect(html).toContain('alt="alt"');
		});
	});

	// ========== KaTeX 公式 ==========

	describe("KaTeX inline math ($...$)", () => {
		it("renders $...$ with katex class", () => {
			const html = render("$E=mc^2$");
			expect(html).toContain('<span class="katex">');
		});

		it("renders \\(...\\) as inline katex", () => {
			const html = render("\\(E=mc^2\\)");
			expect(html).toContain('<span class="katex">');
			// 原始 LaTeX 仅存于 MathML annotation（无障碍，视觉隐藏）
			expect(html).toContain("<annotation");
			expect(html).toContain("E=mc^2");
			// 分隔符已被替换
			expect(html).not.toContain("\\(");
			expect(html).not.toContain("\\)");
		});
	});

	describe("KaTeX display math ($$...$$)", () => {
		it("renders $$...$$ as katex-display", () => {
			const html = render("$$\\int_a^b f(x)dx$$");
			expect(html).toContain("katex-display");
		});

		it("renders \\[...\\] as katex-display", () => {
			const html = render("\\[\\int_a^b f(x)dx\\]");
			expect(html).toContain("katex-display");
			expect(html).not.toContain("\\[");
			expect(html).not.toContain("\\]");
		});
	});

	describe("KaTeX \\sqrt rendering", () => {
		it("renders sqrt SVG with preserveAspectRatio", () => {
			const html = render("$$\\sqrt{1-x^2}$$");
			// 修复的关键：SVG 根号需要此属性
			expect(html).toContain("preserveAspectRatio");
			expect(html).toContain("<svg");
			expect(html).toContain("<path");
			expect(html).toContain("katex");
		});

		it("renders complex formula with sqrt and frac", () => {
			const html = render(
				"$$\\frac{d}{dx}\\arcsin x = \\frac{1}{\\sqrt{1-x^2}}$$",
			);
			expect(html).toContain("katex-display");
			expect(html).toContain("<svg");
			expect(html).toContain("preserveAspectRatio");
			expect(html).toContain("frac-line");
			// 原始 LaTeX 分隔符已被转换
			expect(html).not.toContain("\\(");
			expect(html).not.toContain("\\)");
		});
	});

	describe("KaTeX fraction", () => {
		it("renders \\frac with frac-line", () => {
			const html = render("$$\\frac{1}{2}$$");
			expect(html).toContain("frac-line");
		});
	});

	// ========== 公式与文本混合 ==========

	describe("mixed content", () => {
		it("renders text around inline math", () => {
			const html = render("质能方程：$E=mc^2$ 是核心公式");
			expect(html).toContain("质能方程");
			expect(html).toContain("核心公式");
			expect(html).toContain('<span class="katex">');
		});

		it("renders multiple inline formulas", () => {
			const html = render(
				"当 $a \\ne 0$ 时，$x = {-b \\pm \\sqrt{b^2-4ac} \\over 2a}$",
			);
			const katexSpans = html.match(/<span class="katex">/g);
			expect(katexSpans?.length).toBe(2);
		});
	});

	// ========== 边界情况 ==========

	describe("edge cases", () => {
		it("handles empty content", () => {
			expect(render("")).toBe("");
		});

		it("handles inline mode", () => {
			const html = render("**bold**\n\nnew paragraph", true);
			// inline 模式下不会出现块级元素
			expect(html).toContain("<strong>bold</strong>");
		});
	});
});
