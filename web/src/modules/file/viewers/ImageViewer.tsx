import { createSignal, Show } from "solid-js";
import { DownloadPanel } from "./DownloadPanel.tsx";
import { PreviewMedia } from "./PreviewMedia.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/**
 * 图片：点开原图（新窗口），站内只做 contain 缩放。
 *
 * <img> 加载失败也要有交代：`image/*` 的浏览器支持度并不齐（TIFF 只有 Safari 会渲染，
 * 将来新增的格式同理），不处理就只剩一个破图图标。这里退回下载面板并说清原因；
 * 失败按 stored_id 记录，切到下一个文件自动复位。
 */
export const ImageViewer: ViewerComponent = (props) => {
	const [brokenId, setBrokenId] = createSignal<string>();
	const broken = () => brokenId() === props.item.stored_id;

	return (
		<Show
			when={!broken()}
			fallback={
				<DownloadPanel
					item={props.item}
					note="这个图片格式浏览器无法预览，下载后用本地看图工具打开"
				/>
			}
		>
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
							onError={() => setBrokenId(props.item.stored_id)}
						/>
					</a>
				)}
			</PreviewMedia>
		</Show>
	);
};
