import { useMediaPlayback } from "../hooks/useMediaPlayback.ts";
import { MediaBar } from "./MediaBar.tsx";
import { PreviewMedia } from "./PreviewMedia.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/**
 * 音频：浏览器原生播放器 + 倍速与播放进度记忆（长播客/有声书常用）。
 */
export const AudioViewer: ViewerComponent = (props) => {
	const playback = useMediaPlayback(() => props.item, "audio");
	return (
		<div class={styles.mediaPane}>
			<PreviewMedia item={props.item} isPrivate={props.item.is_private}>
				{(resolvedUrl) => (
					// biome-ignore lint/a11y/useMediaCaption: 文件预览无字幕源
					<audio
						src={resolvedUrl}
						controls
						class={styles.previewAudio}
						ref={playback.setRef}
					/>
				)}
			</PreviewMedia>
			<MediaBar playback={playback} />
		</div>
	);
};
