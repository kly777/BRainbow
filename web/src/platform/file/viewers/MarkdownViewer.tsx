import { Markdown } from "@components/ui";
import { TextContent } from "./TextContent.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** Markdown：走共享的 Markdown 渲染器（懒加载、已带 sanitize） */
export const MarkdownViewer: ViewerComponent = (props) => (
	<TextContent item={props.item}>
		{(text) => (
			<div class={styles.markdown}>
				<Markdown content={text} />
			</div>
		)}
	</TextContent>
);
