import { Button } from "@components/ui";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { parseCsv } from "../lib/csv.ts";
import { TextContent } from "./TextContent.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 首屏渲染多少行（防超宽表卡死渲染） */
const FIRST_PAGE_ROWS = 500;
/** 每次「载入更多」追加多少行 */
const PAGE_ROWS = 500;
/**
 * 超过这个行数就不再给「全部展开」：一次性渲染十万行会**卡死浏览器**，
 * 那正是当初设行数上限的原因。大表请用「载入更多」往下翻，要全量就下载。
 */
const EXPAND_ALL_MAX_ROWS = 5000;

const CsvTable: Component<{ text: string }> = (props) => {
	const [limit, setLimit] = createSignal(FIRST_PAGE_ROWS);
	const all = createMemo(() => parseCsv(props.text));
	const shown = createMemo(() => all().slice(0, limit()));
	// 夹在总行数内：换文件后行数更少时，不会显示一个假的"还有 N 行"
	const remaining = () => Math.max(0, all().length - shown().length);

	return (
		<>
			<div class={styles.tableWrap}>
				<table class={styles.table}>
					<tbody>
						<For each={shown()}>
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
			{/* 大表不再"只给你 500 行、剩下的下载看"：数据本来就在内存里，往下放就是了 */}
			<Show when={remaining() > 0}>
				<div class={styles.truncateNote}>
					<span>
						已显示 {shown().length} / {all().length} 行
					</span>
					<span class={styles.truncateActions}>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setLimit((n) => n + PAGE_ROWS)}
						>
							载入更多
						</Button>
						<Show when={all().length <= EXPAND_ALL_MAX_ROWS}>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => setLimit(all().length)}
							>
								全部展开
							</Button>
						</Show>
					</span>
				</div>
			</Show>
		</>
	);
};

/** CSV：渲染成表格（不是所有 CSV 都是表格，但绝大多数是；要看原文可下载） */
export const CsvViewer: ViewerComponent = (props) => (
	<TextContent item={props.item}>
		{(text) => <CsvTable text={text} />}
	</TextContent>
);
