/**
 * 标签管理弹窗：列出全部标签及关联文件数，支持重命名、合并、删除。
 * 删除只解除与文件的关联，文件本身保留。
 */

import { Button, Input, Modal } from "@components/ui";
import {
	deleteFileTag,
	type FileTag,
	listFileTags,
	mergeFileTag,
	renameFileTag,
} from "@modules/file/api";
import { getErrorMessage } from "@shared/api";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@shared/utils";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import styles from "./TagManager.module.css";

interface Props {
	isOpen: boolean;
	onClose: () => void;
	/** 标签变动后通知父组件刷新列表 */
	onChanged: () => void;
}

const TagManager: Component<Props> = (props) => {
	const [tags, { refetch }] = createResource<FileTag[]>(() =>
		props.isOpen ? listFileTags() : Promise.resolve([]),
	);
	const [editingId, setEditingId] = createSignal<number | null>(null);
	const [editName, setEditName] = createSignal("");
	const [mergingId, setMergingId] = createSignal<number | null>(null);

	const afterChange = (message: string) => {
		notifySuccess(message);
		refetch();
		props.onChanged();
	};

	const startRename = (tag: FileTag) => {
		setMergingId(null);
		setEditingId(tag.id);
		setEditName(tag.name);
	};

	const submitRename = async () => {
		const id = editingId();
		const name = editName().trim();
		if (!id || !name) return;
		const result = await tryAsync(() => renameFileTag(id, name));
		if (result.ok) {
			setEditingId(null);
			afterChange("标签已重命名");
		} else {
			notifyError("重命名失败", getErrorMessage(result.error));
		}
	};

	const remove = async (tag: FileTag) => {
		const confirmed = await showConfirm({
			title: "删除标签",
			message: `删除「${tag.name}」会从 ${tag.count} 个文件上移除该标签，文件本身不受影响。`,
			variant: "danger",
		});
		if (!confirmed) return;
		const result = await tryAsync(() => deleteFileTag(tag.id));
		if (result.ok) afterChange("标签已删除");
		else notifyError("删除失败", getErrorMessage(result.error));
	};

	const submitMerge = async (fromId: number, targetId: number) => {
		const result = await tryAsync(() => mergeFileTag(fromId, targetId));
		if (result.ok) {
			setMergingId(null);
			afterChange("标签已合并");
		} else {
			notifyError("合并失败", getErrorMessage(result.error));
		}
	};

	return (
		<Modal isOpen={props.isOpen} onClose={props.onClose} title="标签管理">
			<div class={styles.wrap}>
				<Show
					when={(tags() ?? []).length > 0}
					fallback={
						<p class={styles.empty}>还没有标签，在文件详情页可以给文件加标签</p>
					}
				>
					<ul class={styles.list}>
						<For each={tags()}>
							{(tag) => (
								<li class={styles.item}>
									<Show
										when={editingId() === tag.id}
										fallback={
											<>
												<span class={styles.name}>{tag.name}</span>
												<span class={styles.count}>{tag.count}</span>
												<div class={styles.actions}>
													<Button
														variant="secondary"
														size="sm"
														onClick={() => startRename(tag)}
													>
														重命名
													</Button>
													<Button
														variant="secondary"
														size="sm"
														onClick={() =>
															setMergingId(
																mergingId() === tag.id ? null : tag.id,
															)
														}
													>
														合并
													</Button>
													<Button
														variant="danger"
														size="sm"
														onClick={() => remove(tag)}
													>
														删除
													</Button>
												</div>
											</>
										}
									>
										<Input
											class={styles.input}
											value={editName()}
											onInput={(e) => setEditName(e.currentTarget.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter") void submitRename();
												if (e.key === "Escape") setEditingId(null);
											}}
											aria-label={`重命名标签 ${tag.name}`}
										/>
										<div class={styles.actions}>
											<Button
												variant="primary"
												size="sm"
												onClick={submitRename}
											>
												保存
											</Button>
											<Button
												variant="secondary"
												size="sm"
												onClick={() => setEditingId(null)}
											>
												取消
											</Button>
										</div>
									</Show>

									<Show when={mergingId() === tag.id}>
										<div class={styles.mergeRow}>
											<span class={styles.mergeLabel}>合并到：</span>
											<For
												each={(tags() ?? []).filter((t) => t.id !== tag.id)}
												fallback={
													<span class={styles.empty}>没有其他标签可合并</span>
												}
											>
												{(target) => (
													<Button
														variant="secondary"
														size="sm"
														onClick={() => submitMerge(tag.id, target.id)}
													>
														{target.name}
													</Button>
												)}
											</For>
										</div>
									</Show>
								</li>
							)}
						</For>
					</ul>
				</Show>
			</div>
		</Modal>
	);
};

export default TagManager;
