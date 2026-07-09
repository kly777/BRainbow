import { Show } from "solid-js";
import type { MemItem, TagInfo } from "../../apis/memApi.ts";
import MarkdownRenderer from "../ui/Markdown.tsx";
import MarkdownEditor from "../ui/MarkdownEditor.tsx";
import TagSelector from "../TagSelector.tsx";
import { fmtLocal } from "../../lib/time.ts";
import styles from "./MemDetailPanel.module.css";

interface Props {
	mem: MemItem | undefined;
	memTags: TagInfo[];
	editing: boolean;
	editCue: string;
	editTarget: string;
	onEditCueChange: (value: string) => void;
	onEditTargetChange: (value: string) => void;
	onStartEdit: () => void;
	onSaveEdit: () => void;
	onCancelEdit: () => void;
	onReset: (id: number) => void;
	onSuspend: (id: number) => void;
	onUnsuspend: (id: number) => void;
	onDelete: (id: number) => void;
	onAddTag: (tag: TagInfo) => void;
	onRemoveTag: (tagId: number) => void;
}

export default function MemDetailPanel(props: Props) {
	return (
		<div class={styles.detail}>
			<Show
				when={props.mem}
				fallback={<div class={styles.empty}>点击左侧条目查看详情</div>}
			>
				{(d) => (
					<>
						<Show
							when={props.editing}
							fallback={
								<>
									<div class={styles.section}>
										<span class={styles.sectionLabel}>线索</span>
										<div class={styles.content}>
											<MarkdownRenderer content={d().cue.content} />
										</div>
									</div>
									<div class={styles.section}>
										<span class={styles.sectionLabel}>答案</span>
										<div class={styles.content}>
											<MarkdownRenderer content={d().target.content} />
										</div>
									</div>
								</>
							}
						>
							<div class={styles.section}>
								<span class={styles.sectionLabel}>线索</span>
								<MarkdownEditor
									class={styles.editArea}
									value={props.editCue}
									onInput={props.onEditCueChange}
									rows={4}
								/>
							</div>
							<div class={styles.section}>
								<span class={styles.sectionLabel}>答案</span>
								<MarkdownEditor
									class={styles.editArea}
									value={props.editTarget}
									onInput={props.onEditTargetChange}
									rows={4}
								/>
							</div>
						</Show>
						<div class={styles.meta}>
							<span>
								状态：{d().state}
								{d().leeched ? " ⚠️烂卡" : ""}
							</span>
							<span>遗忘：{d().lapses} 次</span>
							<span>难度：{d().difficulty.toFixed(2)}</span>
							<span>创建：{fmtLocal(d().cue.created_at)}</span>
							<span>到期：{fmtLocal(d().due_at)}</span>
						</div>
						<div class={styles.section}>
							<span class={styles.sectionLabel}>标签</span>
							<TagSelector
								tags={props.memTags}
								onAdd={props.onAddTag}
								onRemove={props.onRemoveTag}
							/>
						</div>
						<div class={styles.actionBtns}>
							<Show
								when={props.editing}
								fallback={
									<>
										<button
											type="button"
											class={styles.editBtn}
											onClick={props.onStartEdit}
										>
											编辑
										</button>
										<button
											type="button"
											class={styles.cancelBtn}
											onClick={() => props.onReset(d().id)}
										>
											忘却
										</button>
										<Show when={d().state !== "suspended"}>
											<button
												type="button"
												class={styles.editBtn}
												onClick={() => props.onSuspend(d().id)}
											>
												挂起
											</button>
										</Show>
										<Show when={d().state === "suspended"}>
											<button
												type="button"
												class={styles.editBtn}
												onClick={() => props.onUnsuspend(d().id)}
											>
												恢复
											</button>
										</Show>
										<button
											type="button"
											class={styles.deleteBtn}
											onClick={() => props.onDelete(d().id)}
										>
											删除
										</button>
									</>
								}
							>
								<button
									type="button"
									class={styles.editBtn}
									onClick={props.onSaveEdit}
								>
									保存
								</button>
								<button
									type="button"
									class={styles.cancelBtn}
									onClick={props.onCancelEdit}
								>
									取消
								</button>
							</Show>
						</div>
					</>
				)}
			</Show>
		</div>
	);
}
