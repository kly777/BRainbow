import { createSignal, Show } from "solid-js";
import ImageLightbox from "../components/ImageLightbox.tsx";
import { DownloadPanel } from "./DownloadPanel.tsx";
import { PreviewMedia } from "./PreviewMedia.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/**
 * 图片：站内 contain 缩放，点开进灯箱放大细看。
 *
 * 灯箱只放大**当前这张**，没有翻页：详情页是"单个文件"的页面，不提供跨文件导航
 * （理由见 hooks/useFileDetail.ts）。要在一组图片之间翻，走列表页 —— 那里的灯箱按
 * 当前筛选结果翻页，语义成立。
 *
 * <img> 加载失败也要有交代：`image/*` 的浏览器支持度并不齐（TIFF 只有 Safari 会渲染，
 * 将来新增的格式同理），不处理就只剩一个破图图标。这里退回下载面板并说清原因；
 * 失败按 stored_id 记录，切到下一个文件自动复位。
 */
export const ImageViewer: ViewerComponent = (props) => {
	const [brokenId, setBrokenId] = createSignal<string>();
	const [zoomed, setZoomed] = createSignal(false);
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
			<PreviewMedia item={props.item} isPrivate={props.item.is_private}>
				{(resolvedUrl) => (
					<button
						type="button"
						class={styles.previewZoom}
						title="放大查看"
						onClick={() => setZoomed(true)}
					>
						<img
							src={resolvedUrl}
							alt={props.item.original_name}
							class={styles.previewImg}
							onError={() => setBrokenId(props.item.stored_id)}
						/>
					</button>
				)}
			</PreviewMedia>
			<Show when={zoomed()}>
				{/* 单张：灯箱内部按 items.length > 1 决定要不要显示翻页按钮，这里恒为 1 张 */}
				<ImageLightbox
					items={[props.item]}
					index={0}
					onClose={() => setZoomed(false)}
				/>
			</Show>
		</Show>
	);
};
