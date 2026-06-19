import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import { type Component, createMemo } from "solid-js";
import "highlight.js/styles/github.css";
import "./markdown.css";

// 所有链接在新标签页打开
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof HTMLAnchorElement) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
    }
});

// 配置marked
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

            const rawHtml = marked.parse(content) as string;

            return DOMPurify.sanitize(rawHtml, {
                ALLOWED_TAGS: [
                    "h1", "h2", "h3", "h4", "h5", "h6",
                    "p", "br", "hr",
                    "strong", "em", "b", "i", "u", "s",
                    "blockquote", "code", "pre",
                    "ul", "ol", "li",
                    "table", "thead", "tbody", "tr", "th", "td",
                    "a", "img", "div", "span",
                ],
                ALLOWED_ATTR: [
                    "href", "target", "rel", "title",
                    "src", "alt", "width", "height",
                    "class", "id", "align",
                ],
                ALLOWED_URI_REGEXP:
                    /^(?:(?:https?|mailto|ftp|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
            });
        } catch {
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

export default MarkdownRenderer;
