import { Button } from "@components/ui";
import { type Component, createSignal, For, Show } from "solid-js";
import type { SheetData } from "../hooks/usePreviewDoc.ts";
import { DataTable } from "./DataTable.tsx";
import { DocContent } from "./DocContent.tsx";
import { PreviewState } from "./PreviewState.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 首行当表头（电子表格绝大多数如此），于是长表滚动时列名粘在顶部 */
const SheetTable: Component<{ sheet: SheetData }> = (props) => (
	<DataTable
		head={props.sheet.rows[0] ?? []}
		rows={props.sheet.rows.slice(1)}
		variant="sheet"
	/>
);

/** .xlsx / .xls：每张表一个页签，表格由服务端解析好的单元格文本直接铺 */
export const XlsxViewer: ViewerComponent = (props) => {
	const [active, setActive] = createSignal(0);
	return (
		<DocContent
			item={props.item}
			kind="sheet"
			mismatchNote="这个文件不是电子表格（服务端给的是文档正文）"
			note={(data) => {
				if (data.kind !== "sheet" || data.sheets.length === 0) return undefined;
				const hints: string[] = [];
				if (data.truncated)
					hints.push(`共 ${data.sheets.length} 张表，只显示了前几张`);
				const sheet = data.sheets[Math.min(active(), data.sheets.length - 1)];
				if (sheet && sheet.rows.length < sheet.total_rows)
					hints.push(
						`只显示了前 ${sheet.rows.length} 行（共 ${sheet.total_rows} 行）`,
					);
				if (sheet) hints.push(`下载可查看完整内容`);
				return hints.length > 0 ? hints.join(" · ") : undefined;
			}}
		>
			{(data, pager) => {
				if (data.kind !== "sheet") return null;
				if (data.sheets.length === 0)
					return <PreviewState message="这张表里没有内容" />;
				const index = Math.min(active(), data.sheets.length - 1);
				const sheet = data.sheets[index];
				return (
					<>
						<Show when={data.sheets.length > 1}>
							<div class={styles.sheetTabs} role="tablist">
								<For each={data.sheets}>
									{(item, i) => (
										<button
											type="button"
											role="tab"
											class={styles.sheetTab}
											aria-selected={i() === index}
											onClick={() => setActive(i())}
										>
											{item.name}
										</button>
									)}
								</For>
							</div>
						</Show>
						{sheet ? <SheetTable sheet={sheet} /> : null}
						{/* 服务端每页 MAX_ROWS 行；还有更多就给出口（游标由服务端给、原样回传） */}
						<Show when={pager.hasMore()}>
							<div class={styles.truncateNote}>
								<span>
									已显示 {sheet?.rows.length ?? 0} 行
									{sheet && sheet.rows.length < sheet.total_rows
										? ` / 共 ${sheet.total_rows} 行`
										: ""}
								</span>
								<span class={styles.truncateActions}>
									<Button
										variant="secondary"
										size="sm"
										disabled={pager.paging()}
										onClick={() => pager.loadMore(index)}
									>
										{pager.paging() ? "载入中…" : "载入更多"}
									</Button>
								</span>
							</div>
						</Show>
					</>
				);
			}}
		</DocContent>
	);
};
