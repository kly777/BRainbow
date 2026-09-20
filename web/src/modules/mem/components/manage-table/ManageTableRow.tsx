import { Badge } from "@components/ui";
import { X } from "@components/ui/icons";
import { fmtRelative, parseUtc } from "@shared/utils";
import { type Component, For, Show } from "solid-js";
import { memStateMeta } from "../../lib/mem-manage-utils.ts";
import styles from "../ManageTable.module.css";
import { previewText, type RowInput } from "./types.ts";

/** 记忆表格的一行：勾选 / 线索 / 答案 / 状态 / 难度 / 复习 / 标签 / 删除 */
const ManageTableRow: Component<RowInput> = (props) => {
	const stateMeta = () => memStateMeta(props.mem.state);
	const overdue = () => parseUtc(props.mem.due_at).getTime() < Date.now();

	return (
		<tr class={props.active ? styles.rowActive : styles.row}>
			<td class={styles.tdCb}>
				<input
					type="checkbox"
					checked={props.selected}
					onInput={() => props.actions.onToggleBatch(props.mem.id)}
					onClick={(e) => e.stopPropagation()}
					aria-label={`选中：${previewText(props.mem.cue.content)}`}
				/>
			</td>
			<td class={styles.td}>
				<button
					type="button"
					class={styles.cellButton}
					onClick={() => props.actions.onSelectRow(props.mem.id)}
				>
					{previewText(props.mem.cue.content)}
				</button>
			</td>
			<td class={styles.td}>
				<button
					type="button"
					class={styles.cellButton}
					onClick={() => props.actions.onSelectRow(props.mem.id)}
				>
					{previewText(props.mem.target.content)}
				</button>
			</td>
			<td class={styles.tdState}>
				<span class={styles.stateCell}>
					<Badge variant={stateMeta().badge}>{stateMeta().label}</Badge>
					<Show when={props.mem.leeched}>
						<span class={styles.leechMark} title="烂卡：多次遗忘">
							烂卡
						</span>
					</Show>
				</span>
			</td>
			<td class={styles.td} title="难度">
				{props.mem.difficulty.toFixed(2)}
			</td>
			<td class={`${styles.tdDue} ${overdue() ? styles.tdOverdue : ""}`}>
				{fmtRelative(props.mem.due_at)}
			</td>
			<td class={styles.td}>
				<div class={styles.cellTags}>
					<For each={props.tags.slice(0, 3)}>
						{(tag) => <span class={styles.cellTag}>{tag.name}</span>}
					</For>
					<Show when={props.tags.length > 3}>
						<span class={styles.cellTag}>+{props.tags.length - 3}</span>
					</Show>
				</div>
			</td>
			<td class={styles.tdAct}>
				<button
					type="button"
					class={styles.delBtn}
					onClick={(e) => {
						e.stopPropagation();
						props.actions.onDelete(props.mem.id);
					}}
					title="删除"
					aria-label={`删除记忆：${previewText(props.mem.cue.content)}`}
				>
					<X size={14} />
				</button>
			</td>
		</tr>
	);
};

export default ManageTableRow;
