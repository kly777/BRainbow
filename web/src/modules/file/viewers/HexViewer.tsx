import { For, Show } from "solid-js";
import { usePreviewBytes } from "../hooks/usePreviewBytes.ts";
import { hexRows, sniffKind } from "../lib/magic.ts";
import { DownloadPanel } from "./DownloadPanel.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/**
 * 二进制兜底查看器：白名单外、也认不出是文本的格式（压缩包、3D 模型、设计稿…）
 * 至少让人看清文件头是什么，而不是只给一个"下载"按钮。
 * 骨架与文本查看器一致：内容获取交给 hook，这里只负责排版。
 */
export const HexViewer: ViewerComponent = (props) => {
	const { content, error } = usePreviewBytes(() => props.item);

	return (
		<div class={styles.hexPane}>
			<Show when={content.loading}>
				<div class={styles.state}>加载中…</div>
			</Show>
			<Show when={error()}>
				{(msg) => <div class={styles.state}>预览失败：{msg()}</div>}
			</Show>
			<Show when={content()}>
				{(c) => (
					<Show
						when={!c().tooLarge}
						fallback={
							<DownloadPanel
								item={props.item}
								note="文件超过 2MB，不做二进制预览；下载后用本地工具查看"
							/>
						}
					>
						<p class={styles.hexVerdict}>文件头：{sniffKind(c().data)}</p>
						<pre class={styles.hexDump}>
							<For each={hexRows(c().data ?? new Uint8Array())}>
								{(row) => (
									<div class={styles.hexRow}>
										<span class={styles.hexOffset}>{row.offset}</span>
										<span class={styles.hexBytes}>{row.hex}</span>
										<span class={styles.hexAscii}>{row.ascii}</span>
									</div>
								)}
							</For>
						</pre>
						<Show when={c().truncated}>
							<div class={styles.truncateNote}>
								仅显示前 4KB（下载可查看完整内容）
							</div>
						</Show>
					</Show>
				)}
			</Show>
		</div>
	);
};
