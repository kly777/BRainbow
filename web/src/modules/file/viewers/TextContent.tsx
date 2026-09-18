// ── 文本类查看器的公共外壳：把"取内容 + 加载中/失败/截断提示"做一次 ──
//
// 各文本查看器因此只负责一件事：`text → JSX`（纯函数，可脱离 DOM 测）。
// 加一个文本类查看器 = 写一个 (text) => JSX + 往注册表加一条。

import { type Component, type JSX, Show } from "solid-js";
import type { FileItem } from "../api.ts";
import { MAX_PREVIEW_BYTES, usePreviewText } from "../hooks/usePreviewText.ts";
import { PreviewError } from "./PreviewError.tsx";
import styles from "./viewers.module.css";

export const TextContent: Component<{
	item: FileItem;
	children: (text: string) => JSX.Element;
}> = (props) => {
	const { content, error, retry } = usePreviewText(() => props.item);

	return (
		<div class={styles.pane}>
			<Show when={content.loading}>
				<div class={styles.state}>加载中…</div>
			</Show>
			<Show when={error()}>
				{(info) => (
					<PreviewError item={props.item} error={info()} onRetry={retry} />
				)}
			</Show>
			<Show when={content()}>
				{(c) => (
					<>
						{props.children(c().text)}
						<Show when={c().truncated}>
							<div class={styles.truncateNote}>
								内容过大，仅预览前 {MAX_PREVIEW_BYTES / 1024 / 1024}
								MB（下载可查看完整内容）
							</div>
						</Show>
					</>
				)}
			</Show>
		</div>
	);
};
