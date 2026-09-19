// ── Office 文档查看器的公共外壳：取解析结果 + 加载中/失败/截断提示 ──
//
// 与 TextContent 同一个套路（各查看器只负责 `data → JSX`），区别有两点：要的是后端
// 解析好的结构而不是原始文本；外壳本身**不滚动**（`.doc-pane` 是 overflow: hidden），
// 滚动交给里面那层内容（正文 / 表格 / 幻灯片列表）——嵌两层 overflow:auto 会让浏览器
// 每帧重算多层可滚动区域，滚动不跟手。

import { type Component, type JSX, Show } from "solid-js";
import type { FileItem } from "../api.ts";
import { type DocPreview, usePreviewDoc } from "../hooks/usePreviewDoc.ts";
import { FindOverlay } from "./FindOverlay.tsx";
import { PreviewError } from "./PreviewError.tsx";
import styles from "./viewers.module.css";

/** 分页能力：只有 sheet / database 用得上（其余类型服务端不给游标） */
export interface PreviewPager {
	/** 还有更多行可载入 */
	hasMore: () => boolean;
	/** 正在载入下一页 */
	paging: () => boolean;
	/** 载入下一页：`index` 是当前活跃容器（第几张表） */
	loadMore: (index: number) => void;
}

export const DocContent: Component<{
	item: FileItem;
	/** 期望的解析结果类型（与查看器对应）：对不上说明后端给的是另一种，直接说清楚 */
	kind: DocPreview["kind"];
	/** 这个类型对不上的提示语 */
	mismatchNote: string;
	/** 截断提示（返回 undefined 表示没被截断） */
	note: (data: DocPreview) => string | undefined;
	children: (data: DocPreview, pager: PreviewPager) => JSX.Element;
}> = (props) => {
	const { preview, error, retry, loadMore, paging, hasMore } = usePreviewDoc(
		() => props.item,
	);
	const pager: PreviewPager = { hasMore, paging, loadMore };
	/** 类型对得上时的数据 */
	const matched = () => {
		const data = preview();
		return data?.kind === props.kind ? data : undefined;
	};
	let paneRef: HTMLDivElement | undefined;

	return (
		<div class={styles.docPane} ref={paneRef}>
			{/* 查找范围是这一层：docx 正文 / 表格 / 幻灯片 / epub 章节都是它的内容 */}
			<FindOverlay
				container={() => paneRef}
				resetKey={() => props.item.stored_id}
			/>
			<Show when={preview.loading}>
				<div class={styles.state}>正在解析文档…</div>
			</Show>
			<Show when={error()}>
				{(info) => (
					<PreviewError item={props.item} error={info()} onRetry={retry} />
				)}
			</Show>
			<Show when={preview() !== undefined && matched() === undefined}>
				<div class={styles.state}>{props.mismatchNote}</div>
			</Show>
			<Show when={matched()}>
				{(data) => (
					<>
						<div class={styles.docBody}>{props.children(data(), pager)}</div>
						<Show when={props.note(data())}>
							{(text) => <div class={styles.truncateNote}>{text()}</div>}
						</Show>
					</>
				)}
			</Show>
		</div>
	);
};
