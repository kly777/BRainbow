import DOMPurify from "dompurify";
import { marked } from "marked";
import { type Component, createMemo } from "solid-js";
import "./markdown.css";

export interface MarkdownProps {
	content: string;
	class?: string;
	inline?: boolean;
}

const Markdown: Component<MarkdownProps> = (props) => {
	// 配置marked选项
	marked.setOptions({
		gfm: true, // 启用GitHub风格的Markdown
		breaks: true, // 将换行符转换为<br>
	});

	// 创建处理后的HTML
	const html = createMemo(() => {
		try {
			let content = props.content;

			// 如果是内联模式，只解析单行内容
			if (props.inline) {
				content = content.replace(/\n/g, " ");
			}

			// 解析Markdown
			const rawHtml = marked.parse(content) as string;

			// 清理HTML，防止XSS攻击
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
				],
				ALLOWED_ATTR: [
					"href",
					"target",
					"rel",
					"title", // 链接属性
					"src",
					"alt",
					"width",
					"height", // 图片属性
					"class",
					"id", // 通用属性
					"align", // 表格对齐
				],
				ALLOWED_URI_REGEXP:
					/^(?:(?:https?|mailto|ftp|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
			});
		} catch (error) {
			console.error("Markdown解析错误:", error);
			return DOMPurify.sanitize(props.content);
		}
	});

	return (
		<div
			class={props.class}
			classList={{
				"markdown-content": true,
				"markdown-inline": props.inline,
			}}
			innerHTML={html()}
		/>
	);
};

export default Markdown;
