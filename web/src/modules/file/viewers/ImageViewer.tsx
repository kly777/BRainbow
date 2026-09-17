import { createMemo, createSignal, Show } from "solid-js";
import ImageLightbox from "../components/ImageLightbox.tsx";
import { canZoom } from "../lib/thumbnail.ts";
import { DownloadPanel } from "./DownloadPanel.tsx";
import { useFileNav } from "./nav.ts";
import { PreviewMedia } from "./PreviewMedia.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/**
 * 图片：站内 contain 缩放，点开进灯箱放大细看（列表页用的是同一个灯箱组件）。
 *
 * 灯箱里能翻页：图片集合取"同批文件里的图片"（判据与列表页同一处 `canZoom`），
 * 那个列表由详情页经 `FileNavContext` 给（见 nav.ts）—— 拿不到时就只有当前这张。
 * 此前这里点一下是"新窗口打开原图"：离开应用、丢掉上下文，大图也没法滚着看细节。
 *
 * <img> 加载失败也要有交代：`image/*` 的浏览器支持度并不齐（TIFF 只有 Safari 会渲染，
 * 将来新增的格式同理），不处理就只剩一个破图图标。这里退回下载面板并说清原因；
 * 失败按 stored_id 记录，切到下一个文件自动复位。
 */
export const ImageViewer: ViewerComponent = (props) => {
	const [brokenId, setBrokenId] = createSignal<string>();
	const [zoomed, setZoomed] = createSignal(false);
	const broken = () => brokenId() === props.item.stored_id;
	const nav = useFileNav();

	/** 灯箱里的图片集合；当前这张不在同批列表里（来源不明）就退回单张 */
	const images = createMemo(() => {
		const list = (nav?.siblings() ?? []).filter(canZoom);
		return list.some((f) => f.stored_id === props.item.stored_id)
			? list
			: [props.item];
	});
	const index = createMemo(() =>
		Math.max(
			0,
			images().findIndex((f) => f.stored_id === props.item.stored_id),
		),
	);

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
				<ImageLightbox
					items={images()}
					index={index()}
					onClose={() => setZoomed(false)}
					onNavigate={(next) => {
						const target = images()[next];
						if (target) nav?.goTo(target);
					}}
				/>
			</Show>
		</Show>
	);
};
