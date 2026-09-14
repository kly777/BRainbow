// ── 预览区宿主：按注册表挑查看器，兜底与"内容缺失"提示在这一层 ──

import { Button } from "@components/ui";
import { AlertTriangle, Download, FileText } from "@components/ui/icons";
import { type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { FileItem } from "../api.ts";
import { pickViewer } from "./registry.ts";
import styles from "./viewers.module.css";

/** 内容已丢失：内联预览与下载都没有意义，统一给出说明 */
const MissingPanel: Component = () => (
	<div class={styles.previewFallback}>
		<AlertTriangle size={48} class={styles.previewMissingIcon} />
		<p class={styles.previewFallbackName}>文件内容已丢失</p>
		<p class={styles.previewMissingHint}>
			数据库里仍保留这条记录，但磁盘上找不到对应文件，无法预览或下载。
			把文件放回上传目录后会自动恢复正常。
		</p>
	</div>
);

/** 没有对应查看器（或该查看器不适用）时的兜底：只说清楚是什么文件，给一个下载入口 */
const DownloadPanel: Component<{ item: FileItem }> = (props) => (
	<div class={styles.previewFallback}>
		<FileText size={48} class={styles.previewFallbackIcon} />
		<p class={styles.previewFallbackName}>{props.item.original_name}</p>
		<Button
			variant="secondary"
			size="sm"
			onClick={() => window.open(props.item.url, "_blank")}
		>
			<Download size={14} /> 下载
		</Button>
	</div>
);

export const PreviewStage: Component<{ item: FileItem }> = (props) => (
	<div class={styles.previewStage}>
		<Show when={!props.item.missing} fallback={<MissingPanel />}>
			<Show
				when={pickViewer(props.item)}
				fallback={<DownloadPanel item={props.item} />}
			>
				{(viewer) => (
					<Dynamic component={viewer().component} item={props.item} />
				)}
			</Show>
		</Show>
	</div>
);
