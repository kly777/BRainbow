import Button from "../ui/Button.tsx";
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
			<Button variant="ghost" size="sm" onClick={props.onReset}>忘却</Button>
			<Button variant="ghost" size="sm" onClick={props.onBury}>埋葬</Button>
			<Button variant="ghost" size="sm" onClick={props.onTag}>标签+</Button>
			<Button variant="ghost" size="sm" onClick={props.onTagRemove}>标签-</Button>
			<Button variant="danger" size="sm" onClick={props.onDelete}>删除</Button>
		</div>
	);
}
