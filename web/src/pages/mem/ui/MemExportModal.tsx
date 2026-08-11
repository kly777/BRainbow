import type { TagInfo } from "@entities/mem";
import { downloadExportCsv, listTagsE } from "@entities/mem";
import { notifyError, tryAsync } from "@shared/lib";
import { Modal } from "@shared/ui";
import { createEffect, createSignal } from "solid-js";
import TagSelector from "./TagSelector.tsx";

interface Props {
	isOpen: boolean;
	onClose: () => void;
}

export default function MemExportModal(props: Props) {
	const [allUserTags, setAllUserTags] = createSignal<TagInfo[]>([]);
	const [exportTagIds, setExportTagIds] = createSignal<number[]>([]);

	createEffect(() => {
		if (props.isOpen) {
			(async () => {
				const result = await tryAsync(() => listTagsE());
				if (result.ok) setAllUserTags(result.value);
				else notifyError("加载标签列表失败", result.error);
			})();
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
					color: "var(--t-color-ink-faint))",
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
						border: "1px solid var(--t-color-border), #e8dfcc)",
						"border-radius": "var(--radius-md)",
						background: "var(--t-color-surface), #fffef9)",
						color: "var(--t-color-ink-muted), #6b5e4a)",
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
