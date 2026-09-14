import { TextContent } from "./TextContent.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 纯文本（txt/pre）：原样保留空白与换行 */
export const PlainTextViewer: ViewerComponent = (props) => (
	<TextContent item={props.item}>
		{(text) => <pre class={styles.pre}>{text}</pre>}
	</TextContent>
);
