import { copyText } from "@shared/utils";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import html from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import markdown from "highlight.js/lib/languages/markdown";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import makefile from "highlight.js/lib/languages/makefile";

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
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import markedKatex from "marked-katex-extension";
import { type Component, createEffect, createMemo, onCleanup } from "solid-js";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import "./markdown.css";

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

export interface MarkdownRendererProps {
	content: string;
}

/// 实例序号：聊天页多条消息各自一个渲染实例，锚点必须跨实例唯一
let mdInstanceSeq = 0;

const MarkdownRenderer: Component<MarkdownRendererProps> = (props) => {
	const instanceId = ++mdInstanceSeq;
	const html = createMemo(() => {
		try {
			let content = props.content;

			// 1. 将 \(...\) 和 \[...\] 转为 $...$ 和 $$...$$
			content = content
				.replace(/\\\(/g, "$")
				.replace(/\\\)/g, "$")
				.replace(/\\\[/g, "$$$$")
				.replace(/\\\]/g, "$$$$");

			// 2. marked 解析（含 markedKatex 插件自动处理 $...$ / $$...$$）
			const rawHtml = marked.parse(content) as string;

			return DOMPurify.sanitize(rawHtml, {
				ALLOWED_TAGS: [
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
				],
				ALLOWED_ATTR: [
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
				],
				ALLOWED_URI_REGEXP:
					/^(?:(?:https?|mailto|ftp|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
			});
		} catch {
			return DOMPurify.sanitize(props.content);
		}
	});

	let divRef: HTMLDivElement | undefined;

	// 图片加载失败（文件缺失/被删除）时替换为占位，避免破图
	createEffect(() => {
		html();
		const div = divRef;
		if (!div) return;
		const handlers: Array<[HTMLImageElement, () => void]> = [];
		for (const img of div.querySelectorAll("img")) {
			const handler = () => {
				const ph = document.createElement("span");
				ph.className = "markdown-broken-image";
				ph.setAttribute("aria-hidden", "true");
				img.replaceWith(ph);
			};
			img.addEventListener("error", handler);
			handlers.push([img, handler]);
		}
		onCleanup(() => {
			for (const [img, h] of handlers) img.removeEventListener("error", h);
		});
	});

	// 标题锚点：h1-h3 按出现顺序加实例唯一 id（供页面级目录导航扫描定位；
	// 同页多实例不再产生重复 DOM id——审计 F8）
	createEffect(() => {
		html();
		const div = divRef;
		if (!div) return;
		let n = 0;
		for (const h of div.querySelectorAll("h1, h2, h3")) {
			h.id = `md-${instanceId}-h-${++n}`;
		}
	});

	// 代码块增强：语言标签 + 复制按钮（流式内容变化时重新处理，已增强的跳过）
	createEffect(() => {
		html();
		const div = divRef;
		if (!div) return;
		const cleanups: Array<() => void> = [];
		for (const pre of div.querySelectorAll<HTMLPreElement>(
			"pre:not(.md-code-enhanced)",
		)) {
			const code = pre.querySelector("code");
			if (!code) continue;
			pre.classList.add("md-code-enhanced");

			const bar = document.createElement("div");
			bar.className = "md-code-bar";
			const lang = [...code.classList]
				.find((c) => c.startsWith("language-"))
				?.slice(9);
			if (lang) {
				const label = document.createElement("span");
				label.className = "md-code-lang";
				label.textContent = lang;
				bar.appendChild(label);
			}
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "md-code-copy";
			btn.textContent = "复制";
			const onCopy = () => {
				void copyText(code.textContent ?? "").then((ok) => {
					if (!ok) return;
					btn.textContent = "✓ 已复制";
					setTimeout(() => (btn.textContent = "复制"), 1500);
				});
			};
			btn.addEventListener("click", onCopy);
			bar.appendChild(btn);
			pre.prepend(bar);
			cleanups.push(() => btn.removeEventListener("click", onCopy));
		}
		onCleanup(() => {
			for (const c of cleanups) c();
		});
	});

	return (
		<div
			ref={divRef}
			classList={{
				"markdown-content": true,
			}}
			innerHTML={html()}
		/>
	);
};

export default MarkdownRenderer;
