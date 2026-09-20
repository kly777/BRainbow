import { Button } from "@components/ui";
import { Download, FileText } from "@components/ui/icons";
import type { Component } from "solid-js";
import type { FileItem } from "../api.ts";
import { PreviewState } from "./PreviewState.tsx";

/**
 * 没有可用查看器时的兜底：说清楚是什么文件，给一个下载入口。
 * 也供查看器在"这个格式我渲染不了"时复用（如 ImageViewer 的 onError）。
 */
export const DownloadPanel: Component<{ item: FileItem; note?: string }> = (
	props,
) => (
	<PreviewState
		message={props.item.original_name}
		hint={props.note}
		icon={<FileText size={32} />}
	>
		<Button
			variant="secondary"
			size="sm"
			onClick={() => window.open(props.item.url, "_blank")}
		>
			<Download size={14} /> 下载
		</Button>
	</PreviewState>
);
