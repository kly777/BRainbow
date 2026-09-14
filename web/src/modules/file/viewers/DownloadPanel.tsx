import { Button } from "@components/ui";
import { Download, FileText } from "@components/ui/icons";
import { type Component, Show } from "solid-js";
import type { FileItem } from "../api.ts";
import styles from "./viewers.module.css";

/**
 * 没有可用查看器时的兜底：说清楚是什么文件，给一个下载入口。
 * 也供查看器在"这个格式我渲染不了"时复用（如 ImageViewer 的 onError）。
 */
export const DownloadPanel: Component<{ item: FileItem; note?: string }> = (
	props,
) => (
	<div class={styles.previewFallback}>
		<FileText size={48} class={styles.previewFallbackIcon} />
		<p class={styles.previewFallbackName}>{props.item.original_name}</p>
		<Show when={props.note}>
			{(note) => <p class={styles.previewFallbackNote}>{note()}</p>}
		</Show>
		<Button
			variant="secondary"
			size="sm"
			onClick={() => window.open(props.item.url, "_blank")}
		>
			<Download size={14} /> 下载
		</Button>
	</div>
);
