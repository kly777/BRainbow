import Badge from "../../../components/ui/Badge.tsx";
import { fmtLocal } from "../../../lib/time.ts";
import type { MemItem } from "../api.ts";
import styles from "./MemDetailPanel.module.css";

/** 详情面板的元信息行：状态、遗忘次数、难度、创建/到期时间 */
export default function MemMetaRow(props: { mem: MemItem }) {
	const d = () => props.mem;
	return (
		<div class={styles.meta}>
			<span>
				状态：
				<Badge
					variant={
						d().state as
							| "new"
							| "learning"
							| "review"
							| "relearning"
							| "suspended"
					}
				>
					{d().state}
				</Badge>
				{d().leeched ? " ⚠️烂卡" : ""}
			</span>
			<span>遗忘：{d().lapses} 次</span>
			<span>难度：{d().difficulty.toFixed(2)}</span>
			<span>创建：{fmtLocal(d().cue.created_at)}</span>
			<span>到期：{fmtLocal(d().due_at)}</span>
		</div>
	);
}
