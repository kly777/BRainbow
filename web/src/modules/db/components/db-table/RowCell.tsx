// 数据单元：外键值可跳转、主键可开行详情（从 DbTable.tsx 下钻）

import { type Component, Show } from "solid-js";
import type { ColumnInfo } from "../../api.ts";
import styles from "../DbTable.module.css";

export interface RowCellProps {
	col: ColumnInfo | undefined;
	text: string;
	preview: string;
	onJump: (targetTable: string, refCol: string, value: string) => void;
	onOpenDetail: (key: string) => void;
}

const RowCell: Component<RowCellProps> = (props) => (
	<td title={props.text}>
		<Show
			when={props.col?.ref_table && props.text}
			fallback={
				<Show when={props.col?.is_primary} fallback={<span>{props.text}</span>}>
					<button
						type="button"
						class={styles.primaryKeyLink}
						title="查看行详情"
						onClick={() => props.onOpenDetail(props.text)}
					>
						{props.text}
					</button>
				</Show>
			}
		>
			<button
				type="button"
				class={styles.cellLink}
				title={
					props.preview
						? `${props.text} · ${props.preview}`
						: `跳转到 ${props.col?.ref_table}`
				}
				onClick={() =>
					props.onJump(
						props.col?.ref_table ?? "",
						props.col?.ref_column ?? "id",
						props.text,
					)
				}
			>
				<span class={styles.cellValue}>{props.text}</span>
				<Show when={props.preview}>
					<span class={styles.cellPreview}>{props.preview}</span>
				</Show>
			</button>
		</Show>
	</td>
);

export default RowCell;
