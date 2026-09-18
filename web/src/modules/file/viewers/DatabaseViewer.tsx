import { type Component, createSignal, For, Show } from "solid-js";
import type { DatabaseTable } from "../hooks/usePreviewDoc.ts";
import { DataTable } from "./DataTable.tsx";
import { DocContent } from "./DocContent.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

const TableView: Component<{ table: DatabaseTable }> = (props) => (
	<DataTable
		head={props.table.columns}
		rows={props.table.rows}
		variant="sheet"
	/>
);

/**
 * SQLite 数据库：只读列出表结构与前若干行。
 *
 * 解析全在后端，而且是**只读 + 不可变**打开、不接受任何客户端 SQL、行/列/单元格
 * 都有上限（详见 `preview.rs` 的 `parse_database`）。所以这里只做展示，
 * 不提供编辑 —— 要改数据把库下载下来用本地工具。
 */
export const DatabaseViewer: ViewerComponent = (props) => {
	const [active, setActive] = createSignal(0);
	return (
		<DocContent
			item={props.item}
			kind="database"
			mismatchNote="这个文件不是 SQLite 数据库（服务端给的是别的类型）"
			note={(data) => {
				if (data.kind !== "database") return undefined;
				const hints = ["只读预览：每张表最多 100 行"];
				if (data.truncated) hints.push("表太多，只显示了前 50 张");
				return hints.join(" · ");
			}}
		>
			{(data) => {
				if (data.kind !== "database") return null;
				if (data.tables.length === 0)
					return <p class={styles.state}>这个库里没有表</p>;
				const index = Math.min(active(), data.tables.length - 1);
				const table = data.tables[index];
				return (
					<>
						<Show when={data.tables.length > 1}>
							<div class={styles.sheetTabs} role="tablist">
								<For each={data.tables}>
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
						{table ? <TableView table={table} /> : null}
					</>
				);
			}}
		</DocContent>
	);
};
