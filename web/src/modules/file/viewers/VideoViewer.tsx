import { useMediaPlayback } from "../hooks/useMediaPlayback.ts";
import { MediaBar } from "./MediaBar.tsx";
import { PreviewMedia } from "./PreviewMedia.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/**
 * 视频：浏览器原生播放器（后端只对 video/* 内联响应，可直接给 src）。
 * 补了两件原生没有的事：倍速与播放进度记忆（见 hooks/useMediaPlayback.ts）。
 */
export const VideoViewer: ViewerComponent = (props) => {
	const playback = useMediaPlayback(() => props.item, "video");
	return (
		<div class={styles.mediaPane}>
			<PreviewMedia item={props.item} isPrivate={props.item.is_private}>
				{(resolvedUrl) => (
					// biome-ignore lint/a11y/useMediaCaption: 文件预览无字幕源
					<video
						src={resolvedUrl}
						controls
						class={styles.previewMedia}
						ref={playback.setRef}
					/>
				)}
			</PreviewMedia>
			<MediaBar playback={playback} />
		</div>
	);
};
