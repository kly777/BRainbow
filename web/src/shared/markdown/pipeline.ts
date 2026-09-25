// ── Markdown 渲染管线（唯一来源） ──
//
// 这里只放"配置 + 纯函数"：hljs 语言注册、DOMPurify 两个 hook、marked 配置、
// 白名单、以及 `renderMarkdown`。DOM 后处理（图片兜底 / 标题锚点 / 代码块复制按钮）
// 属于组件，留在 `components/ui/atoms/MarkdownCore.tsx`。
//
// 为什么单独放 shared/markdown/ 而不是 shared/utils/：本模块在 import 期就注册
// highlight.js 语言、给 DOMPurify 挂全局 hook，属于"重副作用"模块；`shared/utils`
// 有 barrel，把它并进去会让每个 `@shared/utils` 消费者都拖上 markdown 工具链
// （首屏同步链约 180KB 的警戒线，见 AGENTS.md）。同理，本目录不出现在任何 barrel 里。
//
// 它取代了原先"实现一份、测试抄一份"的写法：那份拷贝已经漂移——实现的
// `ALLOWED_ATTR` 明确不放行 `"id"`（内容自带 id 会与标题锚点碰撞），拷贝里却留着
// `"id"`，于是测试一直在断言一个不存在的白名单，还漏了 style 剥离（审计 F5）。

import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import html from "highlight.js/lib/languages/xml";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import markedKatex from "marked-katex-extension";

// Register languages
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("php", php);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", html);
hljs.registerLanguage("css", css);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("makefile", makefile);

// 所有链接在新标签页打开
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
	if (node instanceof HTMLAnchorElement) {
		node.setAttribute("target", "_blank");
		node.setAttribute("rel", "noopener noreferrer");
	}
});

// style 属性仅 KaTeX 渲染需要：非 KaTeX 子树的 style 一律剥离。
// 否则 AI/笔记内容可携带内联 CSS（background:url 外呼、position:fixed
// 页内覆盖层钓鱼）——白名单无法按标签收敛，改用子树判定（审计 F5）
//
// 注意下面那个 `\\s` 是**字面反斜杠 + s**（正则里等于匹配文本 "\s"），不是空白类——
// 即"空白分隔的 class"这一支永远不生效，靠 `closest(".katex")` 兜着。看着像手滑，
// 但"放开它"等于放宽哪些节点能保留内联 style（正是 F5 要收紧的面），改动前先想清
// 谁能伪造 `class="katex..."`（`class` 在白名单里，内容可以自带），别顺手机改。
const isKaTeXContext = (el: Element): boolean => {
	if (/(^|\\s)katex(-|\\s|$)/.test(el.getAttribute("class") ?? "")) return true;
	return el.closest?.(".katex") != null;
};
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
	const el = node as Element;
	if (
		el.nodeType !== 1 ||
		!(el instanceof Element) ||
		!el.hasAttribute("style")
	) {
		return;
	}
	if (!isKaTeXContext(el)) {
		el.removeAttribute("style");
	}
});

// 配置 marked
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

marked.setOptions({
	gfm: true,
	breaks: true,
});

export const ALLOWED_TAGS: readonly string[] = [
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
	// KaTeX MathML（无障碍备选）
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

export const ALLOWED_ATTR: readonly string[] = [
	"href",
	"target",
	"rel",
	"title",
	"src",
	"alt",
	"width",
	"height",
	"class",
	// "id" 不放行：内容自带 id 会与标题锚点碰撞；标题 id 由组件统一分配
	"align",
	// KaTeX 必需
	"style",
	"aria-hidden",
	"encoding",
	"xmlns",
	"d",
	"viewBox",
	"fill",
	"stroke",
	// KaTeX SVG sqrt 必需
	"preserveAspectRatio",
];

export const ALLOWED_URI_REGEXP =
	/^(?:(?:https?|mailto|ftp|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** KaTeX 的行内/块级分隔符归一：`\(…\)` → `$…$`、`\[…\]` → `$$…$$` */
function normalizeMathDelimiters(content: string): string {
	return content
		.replace(/\\\(/g, "$")
		.replace(/\\\)/g, "$")
		.replace(/\\\[/g, "$$$$")
		.replace(/\\\]/g, "$$$$");
}

/**
 * Markdown → 已消毒的 HTML。
 * 解析失败（marked/katex 抛错）时退化为"只消毒原文"，不让内容整块消失。
 */
export function renderMarkdown(content: string): string {
	try {
		const rawHtml = marked.parse(normalizeMathDelimiters(content)) as string;
		return DOMPurify.sanitize(rawHtml, {
			ALLOWED_TAGS: [...ALLOWED_TAGS],
			ALLOWED_ATTR: [...ALLOWED_ATTR],
			ALLOWED_URI_REGEXP,
		});
	} catch {
		return DOMPurify.sanitize(content);
	}
}
