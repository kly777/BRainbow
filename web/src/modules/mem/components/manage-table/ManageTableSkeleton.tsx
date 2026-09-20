import { For } from "solid-js";
import styles from "../ManageTable.module.css";

// 骨架行宽（%），模拟最终表格的行节奏
const SKELETON_WIDTHS = [82, 64, 91, 58, 76, 68];

/** 表格骨架：4 列（勾选 / 线索 / 答案 / 标签）× 6 行，行宽错落以免看着像栅格 */
export default function ManageTableSkeleton() {
	return (
		<div class={styles.tableCard} role="status" aria-label="记忆列表加载中">
			<div class={styles.skHead} aria-hidden="true">
				<span class={`skeleton ${styles.skCb}`} />
				<span class={`skeleton ${styles.skBar}`} />
				<span class={`skeleton ${styles.skBar}`} />
				<span class={`skeleton ${styles.skChip}`} />
			</div>
			<For each={SKELETON_WIDTHS}>
				{(w) => (
					<div class={styles.skRow} aria-hidden="true">
						<span class={`skeleton ${styles.skCb}`} />
						<span
							class={`skeleton ${styles.skBar}`}
							style={{ width: `${w}%` }}
						/>
						<span
							class={`skeleton ${styles.skBar}`}
							style={{ width: `${Math.max(28, w - 34)}%` }}
						/>
						<span class={`skeleton ${styles.skChip}`} />
					</div>
				)}
			</For>
		</div>
	);
}
