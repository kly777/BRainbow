import { type Component, createMemo, For } from "solid-js";
import { parseCsv } from "../lib/csv.ts";
import { TextContent } from "./TextContent.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 表格渲染行数上限（防超宽表卡死渲染） */
const MAX_TABLE_ROWS = 500;

const CsvTable: Component<{ text: string }> = (props) => {
	const rows = createMemo(() => parseCsv(props.text).slice(0, MAX_TABLE_ROWS));
	return (
		<div class={styles.tableWrap}>
			<table class={styles.table}>
				<tbody>
					<For each={rows()}>
						{(row) => (
							<tr>
								<For each={row}>
									{(cell) => <td class={styles.tableCell}>{cell}</td>}
								</For>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	);
};

/** CSV：渲染成表格（不是所有 CSV 都是表格，但绝大多数是；要看原文可下载） */
export const CsvViewer: ViewerComponent = (props) => (
	<TextContent item={props.item}>
		{(text) => <CsvTable text={text} />}
	</TextContent>
);
