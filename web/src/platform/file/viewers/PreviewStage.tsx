// ── 预览区宿主：按注册表挑查看器，兜底与"内容缺失"提示在这一层 ──

import { AlertTriangle } from "@components/ui/icons";
import { type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { FileItem } from "../api.ts";
import { DownloadPanel } from "./DownloadPanel.tsx";
import { PreviewState } from "./PreviewState.tsx";
import { pickViewer } from "./registry.ts";
import styles from "./viewers.module.css";

/** 内容已丢失：内联预览与下载都没有意义，统一给出说明 */
const MissingPanel: Component = () => (
	<PreviewState
		message="文件内容已丢失"
		hint="数据库里仍保留这条记录，但磁盘上找不到对应文件，无法预览或下载。把文件放回上传目录后会自动恢复正常。"
		tone="warning"
		icon={<AlertTriangle size={32} />}
	/>
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
