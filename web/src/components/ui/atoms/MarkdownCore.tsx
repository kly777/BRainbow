import { renderMarkdown } from "@shared/markdown/pipeline.ts";
import { copyText } from "@shared/utils";
import { type Component, createEffect, createMemo, onCleanup } from "solid-js";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import "./markdown.css";

// 渲染管线（hljs 注册 / DOMPurify hook / marked 配置 / 白名单 / sanitize）在
// `@shared/markdown/pipeline.ts`；这里只管把 HTML 挂上去之后的 DOM 后处理。
// 样式表留在组件侧：管道是"内容 → 安全 HTML"，视觉归这里。

export interface MarkdownRendererProps {
	content: string;
}

/// 实例序号：聊天页多条消息各自一个渲染实例，锚点必须跨实例唯一
let mdInstanceSeq = 0;

const MarkdownRenderer: Component<MarkdownRendererProps> = (props) => {
	const instanceId = ++mdInstanceSeq;
	const html = createMemo(() => renderMarkdown(props.content));

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
