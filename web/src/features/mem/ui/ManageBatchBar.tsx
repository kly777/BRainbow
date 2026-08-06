// ── v2 批量操作条（选中条目后出现） ──

import styles from "@features/mem/ui/ManageBatchBar.module.css";

interface Props {
	selectedCount: number;
	onReset: () => void;
	onBury: () => void;
	onTag: () => void;
	onTagRemove: () => void;
	onDelete: () => void;
}

export default function ManageBatchBar(props: Props) {
	return (
		<div
			class={styles.batchBar}
			classList={{ [styles.batchBarVisible]: props.selectedCount > 0 }}
		>
			<span class={styles.batchCount}>{props.selectedCount} 条已选</span>
			<div class={styles.batchActions}>
				<button type="button" class={styles.batchBtn} onClick={props.onReset}>
					忘却
				</button>
				<button type="button" class={styles.batchBtn} onClick={props.onBury}>
					埋葬
				</button>
				<button type="button" class={styles.batchBtn} onClick={props.onTag}>
					标签+
				</button>
				<button
					type="button"
					class={styles.batchBtn}
					onClick={props.onTagRemove}
				>
					标签-
				</button>
				<button
					type="button"
					class={styles.batchBtnDanger}
					onClick={props.onDelete}
				>
					删除
				</button>
			</div>
		</div>
	);
}
