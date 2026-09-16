import { type Component, createSignal, For, Show } from "solid-js";
import type { SheetData } from "../hooks/usePreviewDoc.ts";
import { DocContent } from "./DocContent.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 单元格 class：`.table-cell` 那套是给 CSV 的（首列当标签强调），表格文件不要那个强调 */
const cellClass = `${styles.tableCell} ${styles.sheetCell}`;

const SheetTable: Component<{ sheet: SheetData }> = (props) => (
	<div class={styles.tableWrap}>
		<table class={styles.table}>
			<tbody>
				<For each={props.sheet.rows}>
					{(row) => (
						<tr>
							<For each={row}>
								{(cell) => <td class={cellClass}>{cell}</td>}
							</For>
						</tr>
					)}
				</For>
			</tbody>
		</table>
	</div>
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
			{(data) => {
				if (data.kind !== "sheet") return null;
				if (data.sheets.length === 0)
					return <p class={styles.state}>这张表里没有内容</p>;
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
					</>
				);
			}}
		</DocContent>
	);
};
