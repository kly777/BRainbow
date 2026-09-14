import { Markdown } from "@components/ui";
import { Show } from "solid-js";
import { codeFence, codeLang } from "../lib/filename.ts";
import { TextContent } from "./TextContent.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 语法高亮阈值：超过此长度交给纯文本渲染，避免高亮大文件卡住主线程 */
const MAX_HIGHLIGHT_CHARS = 100_000;

/**
 * 源码 / 配置：按扩展名（或 Dockerfile 这类特殊文件名）取高亮语言，复用 Markdown 的
 * 代码块渲染拿到语法高亮与主题，不额外引高亮库。
 * 超过阈值就退回 <pre> —— 高亮 10 万字符以上会明显卡住主线程。
 */
export const CodeViewer: ViewerComponent = (props) => {
	const lang = () => codeLang(props.item.original_name);
	return (
		<TextContent item={props.item}>
			{(text) => (
				<div class={styles.markdown}>
					<Show
						when={text.length <= MAX_HIGHLIGHT_CHARS}
						fallback={<pre class={styles.pre}>{text}</pre>}
					>
						<Markdown content={codeFence(text, lang())} />
					</Show>
				</div>
			)}
		</TextContent>
	);
};
