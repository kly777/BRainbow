// ── 文本类查看器的公共外壳：把"取内容 + 加载中/失败/截断提示"做一次 ──
//
// 各文本查看器因此只负责一件事：`text → JSX`（纯函数，可脱离 DOM 测）。
// 加一个文本类查看器 = 写一个 (text) => JSX + 往注册表加一条。
//
// 被截断时**必须给出口**：原先只有一句"仅预览前 2MB（下载可查看完整内容）"，等于承认
// 预览到此为止。现在给「载入更多」（往下续一段）与「看结尾」（一次请求跳到尾部 ——
// 大日志最常看的正是末尾，后端支持 `bytes=-N` 后缀请求）。

import { Button } from "@components/ui";
import { formatBytes } from "@shared/utils";
import { type Component, type JSX, Show } from "solid-js";
import type { FileItem } from "../api.ts";
import { type PreviewText, usePreviewText } from "../hooks/usePreviewText.ts";
import { PreviewError } from "./PreviewError.tsx";
import styles from "./viewers.module.css";

/** 截断提示的文案（三个状态：尾部 / 还能续 / 已到末尾但只是开头部分） */
function noticeOf(state: PreviewText): string {
	const loaded = formatBytes(state.loadedBytes);
	if (state.atTail) {
		return `已跳到文件结尾（显示最后 ${loaded} / 共 ${formatBytes(state.totalBytes)}）`;
	}
	return `已显示 ${loaded} / 共 ${formatBytes(state.totalBytes)}，仅预览了开头部分`;
}

export const TextContent: Component<{
	item: FileItem;
	children: (text: string) => JSX.Element;
}> = (props) => {
	const preview = usePreviewText(() => props.item);

	return (
		<div class={styles.pane}>
			<Show when={preview.loading()}>
				{/* 体积来自接口元数据（item.size_bytes）：首屏不必等响应头就能说清在取多大 */}
				<div class={styles.state}>
					正在读取预览（共 {formatBytes(props.item.size_bytes)}）…
				</div>
			</Show>
			<Show when={preview.error()}>
				{(info) => (
					<PreviewError
						item={props.item}
						error={info()}
						onRetry={preview.retry}
					/>
				)}
			</Show>
			<Show when={preview.content()}>
				{(state) => (
					<>
						{props.children(state().text)}
						<Show when={state().atTail || state().truncated}>
							<div class={styles.truncateNote}>
								<span>{noticeOf(state())}</span>
								<span class={styles.truncateActions}>
									<Show when={state().atTail}>
										<Button
											variant="secondary"
											size="sm"
											onClick={preview.reload}
										>
											回到开头
										</Button>
									</Show>
									<Show when={!state().atTail}>
										<Button
											variant="secondary"
											size="sm"
											disabled={preview.busy()}
											onClick={preview.loadMore}
										>
											载入更多
										</Button>
										<Button
											variant="secondary"
											size="sm"
											disabled={preview.busy()}
											onClick={preview.loadTail}
										>
											看结尾
										</Button>
									</Show>
								</span>
							</div>
						</Show>
					</>
				)}
			</Show>
		</div>
	);
};
