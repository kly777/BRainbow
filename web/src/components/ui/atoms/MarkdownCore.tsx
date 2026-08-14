import { copyText } from "@lib/utils";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
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
	class?: string;
	inline?: boolean;
}

const MarkdownRenderer: Component<MarkdownRendererProps> = (props) => {
	const html = createMemo(() => {
		try {
			let content = props.content;

			if (props.inline) {
				content = content.replace(/\n/g, " ");
			}

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
					"id",
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

	// 标题锚点：h1-h3 按出现顺序加 id（供页面级目录导航扫描定位）
	createEffect(() => {
		html();
		const div = divRef;
		if (!div) return;
		let n = 0;
		for (const h of div.querySelectorAll("h1, h2, h3")) {
			h.id = `md-h-${++n}`;
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
			class={props.class}
			classList={{
				"markdown-content": true,
				"markdown-inline": props.inline,
			}}
			innerHTML={html()}
		/>
	);
};

export default MarkdownRenderer;
