import TextPreview from "../components/TextPreview.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/**
 * 文本类（text/*）：后端把可识别的文本统一存成 text/*，这里只按 mime 进，
 * 具体怎么渲染（markdown / html / csv / 代码 / 纯文本）由 TextPreview 内部再分派。
 */
export const TextViewer: ViewerComponent = (props) => (
	<div class={styles.textPaneWrap}>
		<TextPreview item={props.item} />
	</div>
);
