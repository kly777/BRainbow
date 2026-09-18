// ── 数据表格（CSV / XLSX / SQLite 共用） ──
//
// 这三处原先各写一遍几乎相同的 `<div.table-wrap><table>…`，于是"表头要不要粘住"
// "单元格能不能复制"这类改进要在三个地方分别做（或漏做）。收成一个组件后，
// 表格类预览的行为只有这一份。
//
// 两种视觉变体：CSV 用 `.table-cell`（首列当标签强调），电子表格与数据库用
// `.table-cell .sheet-cell`（每列等权）。
//
// 无障碍取舍：单元格是"点一下就复制"，但它**不是按钮** —— 不给每格加 `tabIndex`，
// 因为 500×10 的表会变成五千个 tab 停靠点，键盘用户反而走不动。键盘的等价操作是
// 用 Shift+方向键选中单元格文本后 Ctrl+C（文本本来就可选中）。

import { copyText } from "@shared/utils";
import { type Component, createSignal, For, Show } from "solid-js";
import styles from "./viewers.module.css";

export interface DataTableProps {
	/** 表头（可选）：给了就渲染 `<thead>` 并**粘顶**（长表滚动时列名不跑掉） */
	head?: string[];
	rows: string[][];
	/** `csv` 强调首列；`sheet` 每列等权（默认） */
	variant?: "csv" | "sheet";
}

export const DataTable: Component<DataTableProps> = (props) => {
	/** 刚被复制的单元格（用于一闪而过的反馈）；键是 "行:列" */
	const [copied, setCopied] = createSignal<string>();

	const cellClass = () =>
		props.variant === "csv"
			? styles.tableCell
			: `${styles.tableCell} ${styles.sheetCell}`;

	/**
	 * 点单元格即复制其文本。用**静默复制 + 一闪**而不是 toast：对方是"连着抄几个值"
	 * 的场景，toast 会叠一屏。`title` 已经说明了可点。
	 */
	const copyCell = (key: string, value: string) => {
		copyText(value);
		setCopied(key);
		window.setTimeout(
			() => setCopied((current) => (current === key ? undefined : current)),
			800,
		);
	};

	return (
		<div class={styles.tableWrap}>
			<table class={styles.table}>
				<Show when={props.head}>
					{(head) => (
						<thead>
							<tr>
								<For each={head()}>
									{(cell) => (
										<th
											scope="col"
											class={`${cellClass()} ${styles.tableHeadCell}`}
										>
											{cell}
										</th>
									)}
								</For>
							</tr>
						</thead>
					)}
				</Show>
				<tbody>
					<For each={props.rows}>
						{(row, rowIndex) => (
							<tr>
								<For each={row}>
									{(cell, colIndex) => {
										const key = () => `${rowIndex()}:${colIndex()}`;
										return (
											// biome-ignore lint/a11y/useKeyWithClickEvents: 见文件头的无障碍取舍
											<td
												class={`${cellClass()} ${copied() === key() ? styles.tableCellCopied : ""}`}
												// 稳定的钩子：CSS Modules 会把 class 哈希掉，测试不该依赖哈希名
												data-copied={copied() === key() ? "true" : undefined}
												title="点击复制这一格"
												onClick={() => copyCell(key(), cell)}
											>
												{cell}
											</td>
										);
									}}
								</For>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	);
};
