import { Markdown } from "@components/ui";
import { Show } from "solid-js";
import { codeFence, codeLang } from "../lib/filename.ts";
import { PreBlock } from "./PreBlock.tsx";
import { TextContent } from "./TextContent.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 语法高亮阈值：超过此长度交给纯文本渲染，避免高亮大文件卡住主线程 */
const MAX_HIGHLIGHT_CHARS = 100_000;

/**
 * 源码 / 配置：按扩展名（或 Dockerfile 这类特殊文件名）取高亮语言，复用 Markdown 的
 * 代码块渲染拿到语法高亮与主题，不额外引高亮库。
 *
 * 超过阈值退回 PreBlock（等宽 + 行号 + 换行开关 + 复制全文）—— 高亮 10 万字符以上会
 * 明显卡住主线程。**高亮那条路径没有行号**：行被 hljs 拆成了 span，逐行编号要另做一套
 * （高亮内容由共享的 Markdown 组件渲染，不属于本模块）。
 */
export const CodeViewer: ViewerComponent = (props) => {
	const lang = () => codeLang(props.item.original_name);
	return (
		<TextContent item={props.item}>
			{(text) => (
				<Show
					when={text.length <= MAX_HIGHLIGHT_CHARS}
					fallback={<PreBlock text={text} />}
				>
					<div class={styles.markdown}>
						<Markdown content={codeFence(text, lang())} />
					</div>
				</Show>
			)}
		</TextContent>
	);
};
