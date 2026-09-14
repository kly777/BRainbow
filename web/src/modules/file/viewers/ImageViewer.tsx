import { PreviewMedia } from "./PreviewMedia.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 图片：点开原图（新窗口），站内只做 contain 缩放 */
export const ImageViewer: ViewerComponent = (props) => (
	<PreviewMedia src={props.item.url} isPrivate={props.item.is_private}>
		{(resolvedUrl) => (
			<a
				href={resolvedUrl}
				target="_blank"
				rel="noopener noreferrer"
				class={styles.previewLink}
			>
				<img
					src={resolvedUrl}
					alt={props.item.original_name}
					class={styles.previewImg}
				/>
			</a>
		)}
	</PreviewMedia>
);
