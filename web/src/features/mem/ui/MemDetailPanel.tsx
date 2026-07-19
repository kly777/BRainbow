import { Show } from "solid-js";
import TagSelector from "../../../components/TagSelector.tsx";
import MarkdownRenderer from "../../../components/ui/Markdown.tsx";
import MarkdownEditor from "../../../components/ui/MarkdownEditor.tsx";
import type { MemItem, TagInfo } from "../api.ts";
import styles from "./MemDetailPanel.module.css";
import MemActionBar from "./MemActionBar.tsx";
import MemMetaRow from "./MemMetaRow.tsx";

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
						<MemMetaRow mem={d()} />
						<div class={styles.section}>
							<span class={styles.sectionLabel}>标签</span>
							<TagSelector
								tags={props.memTags}
								onAdd={props.onAddTag}
								onRemove={props.onRemoveTag}
							/>
						</div>
						<MemActionBar
							editing={props.editing}
							memState={d().state}
							onStartEdit={props.onStartEdit}
							onSaveEdit={props.onSaveEdit}
							onCancelEdit={props.onCancelEdit}
							onReset={() => props.onReset(d().id)}
							onSuspend={() => props.onSuspend(d().id)}
							onUnsuspend={() => props.onUnsuspend(d().id)}
							onDelete={() => props.onDelete(d().id)}
						/>
					</>
				)}
			</Show>
		</div>
	);
}
