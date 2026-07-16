import { Show } from "solid-js";
import type { MemItem, TagInfo } from "../api.ts";
import { fmtLocal } from "../../../lib/time.ts";
import TagSelector from "../../../components/TagSelector.tsx";
import Badge from "../../../components/ui/Badge.tsx";
import Button from "../../../components/ui/Button.tsx";
import MarkdownRenderer from "../../../components/ui/Markdown.tsx";
import MarkdownEditor from "../../../components/ui/MarkdownEditor.tsx";
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
								状态：
								<Badge
									variant={
										d().state as
											| "new"
											| "learning"
											| "review"
											| "relearning"
											| "suspended"
									}
								>
									{d().state}
								</Badge>
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
										<Button
											variant="secondary"
											size="sm"
											onClick={props.onStartEdit}
										>
											编辑
										</Button>
										<Button
											variant="secondary"
											size="sm"
											onClick={() => props.onReset(d().id)}
										>
											忘却
										</Button>
										<Show when={d().state !== "suspended"}>
											<Button
												variant="secondary"
												size="sm"
												onClick={() => props.onSuspend(d().id)}
											>
												挂起
											</Button>
										</Show>
										<Show when={d().state === "suspended"}>
											<Button
												variant="secondary"
												size="sm"
												onClick={() => props.onUnsuspend(d().id)}
											>
												恢复
											</Button>
										</Show>
										<Button
											variant="danger"
											size="sm"
											onClick={() => props.onDelete(d().id)}
										>
											删除
										</Button>
									</>
								}
							>
								<Button variant="primary" size="sm" onClick={props.onSaveEdit}>
									保存
								</Button>
								<Button
									variant="secondary"
									size="sm"
									onClick={props.onCancelEdit}
								>
									取消
								</Button>
							</Show>
						</div>
					</>
				)}
			</Show>
		</div>
	);
}
