import { X } from "@components/ui/icons";
// ── v2 管理详情：档案卡 ──
// 线索/答案用目录卡标签页，元数据等宽，操作与标签管理

import { MarkdownEditor } from "@components";
import { Button, Markdown as MarkdownRenderer } from "@components/ui";
import {
	MarkdownFilePicker,
	uploadToFileService,
} from "@modules/file/markdown-editor-support.tsx";
import type { MemItem, TagInfo } from "@modules/mem";
import { fmtLocal } from "@shared/utils";
import { type Component, Show } from "solid-js";
import { memStateMeta } from "../lib/mem-manage-utils.ts";
import styles from "./ManageDetail.module.css";
import TagPicker from "./TagPicker.tsx";

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

const DetailHead: Component<{
	id: number;
	state: string;
	leeched: boolean;
	onClose: () => void;
}> = (props) => (
	<div class={styles.detailHead}>
		<span class={styles.detailId}>#{props.id}</span>
		<div class={styles.detailHeadRight}>
			<span class={styles.detailState} data-state={props.state}>
				{memStateMeta(props.state).label}
			</span>
			<Show when={props.leeched}>
				<span class={styles.leechMark} title="烂卡：多次遗忘">
					烂卡
				</span>
			</Show>
			<button
				type="button"
				class={styles.detailClose}
				onClick={props.onClose}
				title="关闭面板"
				aria-label="关闭详情面板"
			>
				<X size={14} />
			</button>
		</div>
	</div>
);

const CueViewSection: Component<{
	tab: string;
	content: string;
}> = (props) => (
	<div class={styles.detailSection}>
		<div class={styles.detailTab}>{props.tab}</div>
		<div class={styles.detailBody}>
			<MarkdownRenderer content={props.content} />
		</div>
	</div>
);

const CueEditSection: Component<{
	tab: string;
	value: string;
	onInput: (value: string) => void;
}> = (props) => (
	<div class={styles.detailSection}>
		<div class={styles.detailTab}>{props.tab}</div>
		<MarkdownEditor
			onUploadFile={uploadToFileService}
			filePicker={MarkdownFilePicker}
			class={styles.editArea}
			value={props.value}
			onInput={props.onInput}
			rows={4}
		/>
	</div>
);

const CueAnswerSection: Component<{
	editing: boolean;
	cueContent: string;
	targetContent: string;
	editCue: string;
	editTarget: string;
	onEditCueChange: (value: string) => void;
	onEditTargetChange: (value: string) => void;
}> = (props) => (
	<Show
		when={props.editing}
		fallback={
			<>
				<CueViewSection tab="线索" content={props.cueContent} />
				<CueViewSection tab="答案" content={props.targetContent} />
			</>
		}
	>
		<CueEditSection
			tab="线索"
			value={props.editCue}
			onInput={props.onEditCueChange}
		/>
		<CueEditSection
			tab="答案"
			value={props.editTarget}
			onInput={props.onEditTargetChange}
		/>
	</Show>
);

const ActionButtons: Component<{
	editing: boolean;
	state: string;
	id: number;
	onStartEdit: () => void;
	onSaveEdit: () => void;
	onCancelEdit: () => void;
	onReset: (id: number) => void;
	onSuspend: (id: number) => void;
	onUnsuspend: (id: number) => void;
	onDelete: (id: number) => void;
}> = (props) => (
	<div class={styles.detailActions}>
		<Show
			when={props.editing}
			fallback={
				<>
					<Button variant="ghost" size="sm" onClick={props.onStartEdit}>
						编辑
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => props.onReset(props.id)}
					>
						忘却
					</Button>
					<Show when={props.state !== "suspended"}>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => props.onSuspend(props.id)}
						>
							挂起
						</Button>
					</Show>
					<Show when={props.state === "suspended"}>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => props.onUnsuspend(props.id)}
						>
							恢复
						</Button>
					</Show>
					<Button
						variant="danger"
						size="sm"
						onClick={() => props.onDelete(props.id)}
					>
						删除
					</Button>
				</>
			}
		>
			<Button variant="primary" size="sm" onClick={props.onSaveEdit}>
				保存
			</Button>
			<Button variant="ghost" size="sm" onClick={props.onCancelEdit}>
				取消
			</Button>
		</Show>
	</div>
);

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
						<DetailHead
							id={d().id}
							state={d().state}
							leeched={d().leeched}
							onClose={props.onClose}
						/>

						{/* 线索 / 答案 */}
						<CueAnswerSection
							editing={props.editing}
							cueContent={d().cue.content}
							targetContent={d().target.content}
							editCue={props.editCue}
							editTarget={props.editTarget}
							onEditCueChange={props.onEditCueChange}
							onEditTargetChange={props.onEditTargetChange}
						/>

						{/* 元数据（label/value 网格，数值等宽） */}
						<div class={styles.meta}>
							<div class={styles.metaItem}>
								<span class={styles.metaLabel}>遗忘</span>
								<span class={styles.metaValue}>{d().lapses} 次</span>
							</div>
							<div class={styles.metaItem}>
								<span class={styles.metaLabel}>难度</span>
								<span class={styles.metaValue}>
									{d().difficulty.toFixed(2)}
								</span>
							</div>
							<div class={styles.metaItem}>
								<span class={styles.metaLabel}>创建</span>
								<span class={styles.metaValue}>
									{fmtLocal(d().cue.created_at)}
								</span>
							</div>
							<div class={styles.metaItem}>
								<span class={styles.metaLabel}>到期</span>
								<span class={styles.metaValue}>{fmtLocal(d().due_at)}</span>
							</div>
						</div>

						{/* 标签 */}
						<div class={styles.detailSection}>
							<div class={styles.detailTab}>标签</div>
							<TagPicker
								selected={props.memTags}
								onAdd={props.onAddTag}
								onRemove={props.onRemoveTag}
								placeholder="搜索或创建标签…"
							/>
						</div>

						{/* 操作 */}
						<ActionButtons
							editing={props.editing}
							state={d().state}
							id={d().id}
							onStartEdit={props.onStartEdit}
							onSaveEdit={props.onSaveEdit}
							onCancelEdit={props.onCancelEdit}
							onReset={props.onReset}
							onSuspend={props.onSuspend}
							onUnsuspend={props.onUnsuspend}
							onDelete={props.onDelete}
						/>
					</div>
				)}
			</Show>
		</aside>
	);
}
