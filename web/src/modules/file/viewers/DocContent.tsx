// ── Office 文档查看器的公共外壳：取解析结果 + 加载中/失败/截断提示 ──
//
// 与 TextContent 同一个套路（各查看器只负责 `data → JSX`），区别在于要的是后端
// 解析好的结构而不是原始文本，所以单独一层：docx / xlsx 两个查看器共用它，
// 截断提示的文案由各自给（一个是"只显示开头"，一个是"只显示前 N 行"）。

import { type Component, type JSX, Show } from "solid-js";
import type { FileItem } from "../api.ts";
import { type DocPreview, usePreviewDoc } from "../hooks/usePreviewDoc.ts";
import styles from "./viewers.module.css";

export const DocContent: Component<{
	item: FileItem;
	/** 期望的解析结果类型（与查看器对应）：对不上说明后端给的是另一种，直接说清楚 */
	kind: DocPreview["kind"];
	/** 这个类型对不上的提示语 */
	mismatchNote: string;
	/** 截断提示（返回 undefined 表示没被截断） */
	note: (data: DocPreview) => string | undefined;
	children: (data: DocPreview) => JSX.Element;
}> = (props) => {
	const { preview, error } = usePreviewDoc(() => props.item);
	/** 类型对得上时的数据 */
	const matched = () => {
		const data = preview();
		return data?.kind === props.kind ? data : undefined;
	};

	return (
		<div class={styles.pane}>
			<Show when={preview.loading}>
				<div class={styles.state}>正在解析文档…</div>
			</Show>
			<Show when={error()}>
				{(msg) => <div class={styles.state}>预览失败：{msg()}</div>}
			</Show>
			<Show when={preview() !== undefined && matched() === undefined}>
				<div class={styles.state}>{props.mismatchNote}</div>
			</Show>
			<Show when={matched()}>
				{(data) => (
					<>
						<div class={styles.docBody}>{props.children(data())}</div>
						<Show when={props.note(data())}>
							{(text) => <div class={styles.truncateNote}>{text()}</div>}
						</Show>
					</>
				)}
			</Show>
		</div>
	);
};
