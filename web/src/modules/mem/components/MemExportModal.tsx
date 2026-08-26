import { Button, Modal } from "@components/ui";
import type { TagInfo } from "@modules/mem";
import { downloadExportCsv, listTagsE } from "@modules/mem";
import { notifyError, tryAsync } from "@shared/utils";
import { createEffect, createSignal } from "solid-js";
import styles from "./MemModalShared.module.css";
import TagPicker from "./TagPicker.tsx";

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
		<Modal
			isOpen={props.isOpen}
			onClose={props.onClose}
			title="导出记忆"
			actions={
				<Button variant="primary" onClick={handleExport}>
					下载 CSV
				</Button>
			}
		>
			<p class={styles.desc}>可选：按标签筛选导出（不选则导出全部）</p>
			<TagPicker
				selected={allUserTags().filter((t) => exportTagIds().includes(t.id))}
				onAdd={(tag) => setExportTagIds((prev) => [...prev, tag.id])}
				onRemove={(tagId) =>
					setExportTagIds((prev) => prev.filter((id) => id !== tagId))
				}
				placeholder="搜索或创建标签…"
			/>
		</Modal>
	);
}
