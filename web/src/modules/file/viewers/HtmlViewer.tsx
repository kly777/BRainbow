import { TextContent } from "./TextContent.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/**
 * HTML：sandbox 空值 = 禁脚本 / 禁同源，只当静态页渲染（防 HTML 文件里的 XSS）。
 * 用 srcdoc 而不是 src：内容已经取到手里，不再让 iframe 自己发一次带不上凭据的请求。
 */
export const HtmlViewer: ViewerComponent = (props) => (
	<TextContent item={props.item}>
		{(text) => (
			<iframe
				class={styles.htmlFrame}
				sandbox=""
				srcdoc={text}
				title="HTML 预览"
			/>
		)}
	</TextContent>
);
