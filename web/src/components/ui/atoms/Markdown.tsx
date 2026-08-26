import { lazy, Suspense } from "solid-js";
import "./markdown.css";
import type { MarkdownRendererProps } from "./MarkdownCore.tsx";

// 富文本渲染工具链（marked/katex/highlight.js/dompurify）按需加载：
// 首屏与弹窗确认框不需要渲染 Markdown 时，不下载 ~470KB（brotli 117KB）工具链。
// Core 模块首次实际渲染时才加载，之后复用缓存。
const MarkdownCore = lazy(() => import("./MarkdownCore.tsx"));

const MarkdownRenderer = (props: MarkdownRendererProps) => (
	<Suspense fallback={<div class="markdown-content" />}>
		<MarkdownCore {...props} />
	</Suspense>
);

export default MarkdownRenderer;
export type { MarkdownRendererProps } from "./MarkdownCore.tsx";
