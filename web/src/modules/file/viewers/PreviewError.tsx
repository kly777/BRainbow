// ── 预览失败的统一呈现：说清原因 + 给下一步（重试 / 下载） ──
//
// 各查看器的失败态此前各写一句"预览失败：HTTP xxx"，用户没有出口。这里把"下一步"
// 收成一处：**可重试的给重试，一律给下载** —— 预览失败不代表文件没用。
//
// 分类在 lib/previewError.ts（纯函数，可直测）；本组件只负责渲染。

import { Button } from "@components/ui";
import { AlertTriangle, Download, RefreshCw } from "@components/ui/icons";
import { type Component, Show } from "solid-js";
import type { FileItem } from "../api.ts";
import type { PreviewErrorInfo } from "../lib/previewError.ts";
import styles from "./viewers.module.css";

export const PreviewError: Component<{
	item: FileItem;
	error: PreviewErrorInfo;
	/** 重试入口（缺省表示这一层拿不到重试能力，按钮不出） */
	onRetry?: () => void;
}> = (props) => (
	<div class={styles.previewError} role="alert">
		<AlertTriangle size={32} class={styles.previewErrorIcon} />
		<p class={styles.previewErrorMessage}>{props.error.message}</p>
		<Show when={props.error.hint}>
			{(hint) => <p class={styles.previewErrorHint}>{hint()}</p>}
		</Show>
		<div class={styles.previewErrorActions}>
			<Show when={props.error.retryable && props.onRetry}>
				<Button variant="secondary" size="sm" onClick={() => props.onRetry?.()}>
					<RefreshCw size={14} /> 重试
				</Button>
			</Show>
			<Button
				variant="secondary"
				size="sm"
				onClick={() => window.open(props.item.url, "_blank")}
			>
				<Download size={14} /> 下载
			</Button>
		</div>
	</div>
);
