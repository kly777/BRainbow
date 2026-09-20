// ── 媒体类查看器的公共外壳：把"私密文件要先换 blob"这件事做一次 ──

import { type Component, type JSX, Show } from "solid-js";
import type { FileItem } from "../api.ts";
import { usePreviewUrl } from "../hooks/usePreviewUrl.ts";
import { PreviewError } from "./PreviewError.tsx";
import { PreviewState } from "./PreviewState.tsx";

/**
 * 统一处理"私密文件要先换 blob"的媒体渲染：加载中给出提示（避免 401 破图），
 * 换 blob 失败时给错误 + 重试（此前失败被吞掉，只会永远停在"正在加载"）。
 */
export const PreviewMedia: Component<{
	item: FileItem;
	isPrivate: boolean;
	children: (url: string) => JSX.Element;
}> = (props) => {
	const preview = usePreviewUrl(
		() => props.item.url,
		() => props.isPrivate,
	);

	// 先判失败：错误块要拿到 error 对象本身（用 Show 的 accessor 而不是 `!` 断言）
	return (
		<Show
			when={preview.error()}
			fallback={
				<Show
					when={preview.url()}
					// keyed 不能省：切文件时 url 从"真值换成另一个真值"
					// （公开文件是同步替换原 URL，私密文件是换新的 blob URL），非 keyed 的 Show
					// 只在真假变化时重建子节点，于是 <img>/<video>/<iframe> 会一直停在首帧的 src 上
					// —— 页面标题、元信息都换了，只有画面不动。回归测试见 FileDetail.render.test.tsx。
					keyed
					fallback={
						<Show when={props.isPrivate}>
							<PreviewState loading message="正在加载私密文件…" />
						</Show>
					}
				>
					{(url) => props.children(url)}
				</Show>
			}
		>
			{(info) => (
				<PreviewError
					item={props.item}
					error={info()}
					onRetry={preview.retry}
				/>
			)}
		</Show>
	);
};
