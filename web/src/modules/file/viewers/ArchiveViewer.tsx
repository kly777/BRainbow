import { formatBytes } from "@shared/utils";
import { For } from "solid-js";
import { DocContent } from "./DocContent.tsx";
import { PreviewState } from "./PreviewState.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 单元格 class：压缩包列表同"表格文件"，首列不做强调 */
const cellClass = `${styles.tableCell} ${styles.sheetCell}`;

/**
 * 压缩包（zip / tar / tar.gz）：**只列条目，不解压**。
 *
 * 目的是回答"这包里有什么"，而不是当解压工具用 —— 解压要么吃满内存、要么需要一套
 * 流式下载，都不是预览该干的事（要看内容就下载下来）。
 */
export const ArchiveViewer: ViewerComponent = (props) => (
	<DocContent
		item={props.item}
		kind="archive"
		mismatchNote="这个文件不是压缩包（服务端给的是别的类型）"
		note={(data) => {
			if (data.kind !== "archive") return undefined;
			const hints = [
				`${data.format} · ${data.entries.length} 项`,
				`解压后约 ${formatBytes(data.total_bytes)}`,
			];
			if (data.truncated) hints.push("只列了前 500 项");
			return hints.join(" · ");
		}}
	>
		{(data) => {
			if (data.kind !== "archive") return null;
			if (data.entries.length === 0)
				return <PreviewState message="这个压缩包里没有条目" />;
			return (
				<div class={styles.tableWrap}>
					<table class={styles.table}>
						<tbody>
							<For each={data.entries}>
								{(entry) => (
									<tr>
										<td class={cellClass}>{entry.name}</td>
										<td class={cellClass}>
											{entry.dir ? "目录" : formatBytes(entry.size)}
										</td>
										<td class={cellClass}>
											{entry.dir || entry.compressed_size === entry.size
												? "—"
												: `${formatBytes(entry.compressed_size)}（压缩后）`}
										</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</div>
			);
		}}
	</DocContent>
);
