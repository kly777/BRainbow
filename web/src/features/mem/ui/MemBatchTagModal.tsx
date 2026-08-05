import TagSelector from "@components/TagSelector.tsx";
import Modal from "@components/ui/Modal.tsx";
import type { TagInfo } from "@features/mem/api.ts";

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
			<p
				style={{
					"margin-bottom": "var(--space-md)",
					"font-size": "var(--text-sm)",
					color: "var(--color-text-muted)",
				}}
			>
				{desc()}
			</p>
			<TagSelector
				tags={[]}
				onAdd={props.mode === "remove" ? props.onRemoveTag : props.onAddTag}
				onRemove={() => {}}
			/>
		</Modal>
	);
}
