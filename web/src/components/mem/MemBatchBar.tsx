import styles from "./MemBatchBar.module.css";

interface Props {
	selectedCount: number;
	onReset: () => void;
	onBury: () => void;
	onTag: () => void;
	onTagRemove: () => void;
	onDelete: () => void;
}

export default function MemBatchBar(props: Props) {
	return (
		<div
			class={styles.batchBar}
			classList={{ [styles.visible]: props.selectedCount > 0 }}
		>
			<span class={styles.count}>{props.selectedCount} 条已选</span>
			<button type="button" class={styles.btnReset} onClick={props.onReset}>
				忘却
			</button>
			<button type="button" class={styles.btnBury} onClick={props.onBury}>
				埋葬
			</button>
			<button type="button" class={styles.btnTag} onClick={props.onTag}>
				标签+
			</button>
			<button type="button" class={styles.btnTagRemove} onClick={props.onTagRemove}>
				标签-
			</button>
			<button type="button" class={styles.btnDelete} onClick={props.onDelete}>
				删除
			</button>
		</div>
	);
}
