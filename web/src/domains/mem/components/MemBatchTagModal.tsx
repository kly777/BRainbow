import { Modal } from "@components/ui";
import type { TagInfo } from "../api.ts";
import styles from "./MemModalShared.module.css";
import TagPicker from "./TagPicker.tsx";

interface Props {
	isOpen: boolean;
	onClose: () => void;
	mode: "add" | "remove";
	selectedCount: number;
	onAddTag: (tag: TagInfo) => void;
	onRemoveTag: (tag: TagInfo) => void;
}

export default function MemBatchTagModal(props: Props) {
	const title = () => (props.mode === "add" ? "批量添加标签" : "批量移除标签");
	const desc = () =>
		`对 ${props.selectedCount} 条记忆${
			props.mode === "add" ? "添加" : "移除"
		}标签`;

	return (
		<Modal isOpen={props.isOpen} onClose={props.onClose} title={title()}>
			<p class={styles.desc}>{desc()}</p>
			<TagPicker
				selected={[]}
				onAdd={props.mode === "remove" ? props.onRemoveTag : props.onAddTag}
				onRemove={() => {}}
				placeholder="搜索或创建标签…"
			/>
		</Modal>
	);
}
