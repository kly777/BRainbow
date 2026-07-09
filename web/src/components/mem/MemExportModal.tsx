import { createSignal, createEffect } from "solid-js";
import type { TagInfo } from "../../apis/memApi.ts";
import { listTagsE, downloadExportCsv } from "../../apis/memApi.ts";
import TagSelector from "../TagSelector.tsx";
import Modal from "../ui/Modal.tsx";

interface Props {
	isOpen: boolean;
	onClose: () => void;
}

export default function MemExportModal(props: Props) {
	const [allUserTags, setAllUserTags] = createSignal<TagInfo[]>([]);
	const [exportTagIds, setExportTagIds] = createSignal<number[]>([]);

	createEffect(() => {
		if (props.isOpen) {
			listTagsE().then(setAllUserTags).catch(() => {});
		}
	});

	const handleExport = async () => {
		await downloadExportCsv(
			exportTagIds().length > 0 ? exportTagIds() : undefined,
		);
		props.onClose();
	};

	return (
		<Modal isOpen={props.isOpen} onClose={props.onClose} title="导出记忆">
			<p
				style={{
					"margin-bottom": "var(--space-md)",
					"font-size": "var(--text-sm)",
					color: "var(--color-text-muted)",
				}}
			>
				可选：按标签筛选导出（不选则导出全部）
			</p>
			<TagSelector
				tags={allUserTags().filter((t) => exportTagIds().includes(t.id))}
				onAdd={(tag) => setExportTagIds((prev) => [...prev, tag.id])}
				onRemove={(tagId) =>
					setExportTagIds((prev) => prev.filter((id) => id !== tagId))
				}
			/>
			<div
				style={{
					"margin-top": "var(--space-md)",
					display: "flex",
					"justify-content": "flex-end",
					gap: "var(--space-sm)",
				}}
			>
				<button
					type="button"
					style={{
						padding: "var(--space-sm)",
						"font-size": "var(--text-sm)",
						border: "1px solid var(--color-border, #e8dfcc)",
						"border-radius": "var(--radius-md)",
						background: "var(--color-surface, #fffef9)",
						color: "var(--color-text-secondary, #6b5e4a)",
						cursor: "pointer",
					}}
					onClick={handleExport}
				>
					下载 CSV
				</button>
			</div>
		</Modal>
	);
}
