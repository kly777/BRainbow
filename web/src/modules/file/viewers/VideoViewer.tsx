import { PreviewMedia } from "./PreviewMedia.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 视频：浏览器原生播放器（后端只对 video/* 内联响应，可直接给 src） */
export const VideoViewer: ViewerComponent = (props) => (
	<PreviewMedia src={props.item.url} isPrivate={props.item.is_private}>
		{(resolvedUrl) => (
			// biome-ignore lint/a11y/useMediaCaption: 文件预览无字幕源
			<video src={resolvedUrl} controls class={styles.previewMedia} />
		)}
	</PreviewMedia>
);
