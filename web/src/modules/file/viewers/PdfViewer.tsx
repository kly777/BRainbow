import { PreviewMedia } from "./PreviewMedia.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/**
 * PDF：用浏览器内置阅读器（<iframe> + 原生渲染，零依赖零体积）。
 * 依赖后端对 application/pdf 的内联响应；私密文件先换成 blob URL 才有凭据。
 */
export const PdfViewer: ViewerComponent = (props) => (
	<PreviewMedia src={props.item.url} isPrivate={props.item.is_private}>
		{(resolvedUrl) => (
			<iframe src={resolvedUrl} class={styles.previewFrame} title="PDF 预览" />
		)}
	</PreviewMedia>
);
