// ── 媒体类查看器的公共外壳：把"私密文件要先换 blob"这件事做一次 ──

import { type Component, type JSX, Show } from "solid-js";
import { usePreviewUrl } from "../hooks/usePreviewUrl.ts";
import styles from "./viewers.module.css";

/**
 * 统一处理"私密文件要先换 blob"的媒体渲染：加载中给出提示，避免 401 破图。
 */
export const PreviewMedia: Component<{
	src: string;
	isPrivate: boolean;
	children: (url: string) => JSX.Element;
}> = (props) => {
	const resolved = usePreviewUrl(
		() => props.src,
		() => props.isPrivate,
	);
	return (
		<Show
			when={resolved()}
			// keyed 不能省：切到下一个文件时 resolved 从"真值换成另一个真值"
			// （公开文件是同步替换原 URL，私密文件是换新的 blob URL），非 keyed 的 Show
			// 只在真假变化时重建子节点，于是 <img>/<video>/<iframe> 会一直停在首帧的 src 上
			// —— 页面标题、元信息都换了，只有画面不动。回归测试见 FileDetail.render.test.tsx。
			keyed
			fallback={
				<Show when={props.isPrivate}>
					<p class={styles.previewLoading}>正在加载私密文件…</p>
				</Show>
			}
		>
			{(url) => props.children(url)}
		</Show>
	);
};
