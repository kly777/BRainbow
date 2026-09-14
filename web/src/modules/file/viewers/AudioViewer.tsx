import { PreviewMedia } from "./PreviewMedia.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 音频：浏览器原生播放器（后端只对 audio/* 内联响应，可直接给 src） */
export const AudioViewer: ViewerComponent = (props) => (
	<PreviewMedia src={props.item.url} isPrivate={props.item.is_private}>
		{(resolvedUrl) => (
			// biome-ignore lint/a11y/useMediaCaption: 文件预览无字幕源
			<audio src={resolvedUrl} controls class={styles.previewAudio} />
		)}
	</PreviewMedia>
);
