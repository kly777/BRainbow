// ── v2 管理详情：档案卡 ──
// 线索/答案用目录卡标签页，元数据等宽，操作与标签管理

import { Show } from "solid-js";
import TagSelector from "@components/TagSelector.tsx";
import MarkdownRenderer from "@components/ui/Markdown.tsx";
import MarkdownEditor from "@components/ui/MarkdownEditor.tsx";
import { fmtLocal } from "@lib/time.ts";
import type { MemItem, TagInfo } from "@features/mem/api.ts";
import styles from "@features/mem/ui/ManageDetail.module.css";

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
	onClose: () => void;
}

const stateLabel: Record<string, string> = {
	new: "新",
	learning: "学习",
	relearning: "重学",
	review: "复习",
	suspended: "挂起",
};

export default function ManageDetail(props: Props) {
	return (
		<aside
			class={styles.detail}
			classList={{ [styles.detailOpen]: props.mem !== undefined }}
		>
			<Show
				when={props.mem}
				fallback={<div class={styles.detailEmpty}>点击左侧条目查看档案</div>}
			>
				{(d) => (
					<div class={styles.detailCard}>
						{/* 档案卡头：编号 + 状态 + 关闭 */}
						<div class={styles.detailHead}>
							<span class={styles.detailId}>#{d().id}</span>
							<div class={styles.detailHeadRight}>
								<span class={styles.detailState} data-state={d().state}>
									{stateLabel[d().state] ?? d().state}
									{d().leeched ? " ⚠️烂卡" : ""}
								</span>
								<button
									type="button"
									class={styles.detailClose}
									onClick={props.onClose}
									title="关闭面板"
								>
									✕
								</button>
							</div>
						</div>

						{/* 线索 / 答案 */}
						<Show
							when={props.editing}
							fallback={
								<>
									<div class={styles.detailSection}>
										<div class={styles.detailTab}>线索</div>
										<div class={styles.detailBody}>
											<MarkdownRenderer content={d().cue.content} />
										</div>
									</div>
									<div class={styles.detailSection}>
										<div class={styles.detailTab}>答案</div>
										<div class={styles.detailBody}>
											<MarkdownRenderer content={d().target.content} />
										</div>
									</div>
								</>
							}
						>
							<div class={styles.detailSection}>
								<div class={styles.detailTab}>线索</div>
								<MarkdownEditor
									class={styles.editArea}
									value={props.editCue}
									onInput={props.onEditCueChange}
									rows={4}
								/>
							</div>
							<div class={styles.detailSection}>
								<div class={styles.detailTab}>答案</div>
								<MarkdownEditor
									class={styles.editArea}
									value={props.editTarget}
									onInput={props.onEditTargetChange}
									rows={4}
								/>
							</div>
						</Show>

						{/* 元数据（等宽） */}
						<div class={styles.meta}>
							<span>遗忘 {d().lapses} 次</span>
							<span>难度 {d().difficulty.toFixed(2)}</span>
							<span>创建 {fmtLocal(d().cue.created_at)}</span>
							<span>到期 {fmtLocal(d().due_at)}</span>
						</div>

						{/* 标签 */}
						<div class={styles.detailSection}>
							<div class={styles.detailTab}>标签</div>
							<TagSelector
								tags={props.memTags}
								onAdd={props.onAddTag}
								onRemove={props.onRemoveTag}
							/>
						</div>

						{/* 操作 */}
						<div class={styles.detailActions}>
							<Show
								when={props.editing}
								fallback={
									<>
										<button
											type="button"
											class={styles.ghostBtn}
											onClick={props.onStartEdit}
										>
											编辑
										</button>
										<button
											type="button"
											class={styles.ghostBtn}
											onClick={() => props.onReset(d().id)}
										>
											忘却
										</button>
										<Show when={d().state !== "suspended"}>
											<button
												type="button"
												class={styles.ghostBtn}
												onClick={() => props.onSuspend(d().id)}
											>
												挂起
											</button>
										</Show>
										<Show when={d().state === "suspended"}>
											<button
												type="button"
												class={styles.ghostBtn}
												onClick={() => props.onUnsuspend(d().id)}
											>
												恢复
											</button>
										</Show>
										<button
											type="button"
											class={styles.dangerBtn}
											onClick={() => props.onDelete(d().id)}
										>
											删除
										</button>
									</>
								}
							>
								<button
									type="button"
									class={styles.primaryBtn}
									onClick={props.onSaveEdit}
								>
									保存
								</button>
								<button
									type="button"
									class={styles.ghostBtn}
									onClick={props.onCancelEdit}
								>
									取消
								</button>
							</Show>
						</div>
					</div>
				)}
			</Show>
		</aside>
	);
}
