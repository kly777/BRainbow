import { Button, Input, Tooltip } from "@components/ui";
import { Copy, Lock } from "@components/ui/icons";
import { copyTextWithToast } from "@shared/utils";
import { type Component, For, Show } from "solid-js";
import type { FileItem } from "../api.ts";
import FileMeta from "../components/FileMeta.tsx";
import styles from "../FileList.module.css";
import { canZoom } from "../lib/thumbnail.ts";
import { FileThumb } from "./FileThumb.tsx";

const FilePreview: Component<{
	item: FileItem;
	onOpen: () => void;
	/** 图片点击打开灯箱（传 null 表示不可放大，退回 onOpen） */
	onZoom?: () => void;
}> = (props) => (
	<button
		type="button"
		class={styles.preview}
		onClick={() => {
			if (canZoom(props.item) && props.onZoom) props.onZoom();
			else props.onOpen();
		}}
		title={
			props.item.missing
				? "文件内容已丢失"
				: canZoom(props.item)
					? "放大查看"
					: "查看详情"
		}
	>
		{/* 私密文件不在这里拉取内容（<img> 不带凭据会 401），进详情页再看 */}
		<FileThumb item={props.item} imgClass={styles.thumb} />
	</button>
);

const FileCardView: Component<{
	item: FileItem;
	onOpen: () => void;
	onStartRename: (item: FileItem) => void;
	onDelete: (stored_id: string) => void;
}> = (props) => (
	<>
		<div class={styles.info}>
			{/* 文件名在卡片里是单行截断的，hover 补全完整名称 */}
			<Tooltip label={props.item.original_name} class={styles.nameTipHost}>
				<button type="button" class={styles.nameBtn} onClick={props.onOpen}>
					{props.item.original_name}
				</button>
			</Tooltip>
			<Show when={props.item.is_private}>
				<p class={styles.privateTag}>
					<Lock size={11} /> 私密（仅自己可见）
				</p>
			</Show>
			<FileMeta item={props.item} />
			<Show when={props.item.tags.length > 0}>
				<div class={styles.tags}>
					<For each={props.item.tags}>
						{(tag) => <span class={styles.tag}>#{tag}</span>}
					</For>
				</div>
			</Show>
		</div>
		<div class={styles.actions}>
			<Button
				variant="icon"
				title="复制文件 URL（可用于 Markdown 引用）"
				onClick={() => copyTextWithToast(props.item.url)}
			>
				<Copy size={14} />
			</Button>
			<Show when={props.item.can_edit}>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => props.onStartRename(props.item)}
				>
					重命名
				</Button>
				<Button
					variant="danger"
					size="sm"
					onClick={() => props.onDelete(props.item.stored_id)}
				>
					删除
				</Button>
			</Show>
		</div>
	</>
);

const FileCardEdit: Component<{
	item: FileItem;
	editName: string;
	onEditName: (value: string) => void;
	onRename: () => void;
	onCancelEdit: () => void;
}> = (props) => (
	<>
		<div class={styles.info}>
			<Input
				value={props.editName}
				onInput={(e) => props.onEditName(e.currentTarget.value)}
				class={styles.editInput}
				onKeyPress={(e) => e.key === "Enter" && props.onRename()}
				aria-label="文件名称"
			/>
			{/* 编辑态保留同样的信息区：与展示态结构一致，避免切换时卡片高度跳变 */}
			<FileMeta item={props.item} />
			{/* 编辑态保留标签行：与展示态内容结构一致，避免切换时卡片高度跳变 */}
			<Show when={props.item.tags.length > 0}>
				<div class={styles.tags}>
					<For each={props.item.tags}>
						{(tag) => <span class={styles.tag}>#{tag}</span>}
					</For>
				</div>
			</Show>
		</div>
		<div class={styles.actions}>
			<Button variant="primary" size="sm" onClick={props.onRename}>
				保存
			</Button>
			<Button variant="secondary" size="sm" onClick={props.onCancelEdit}>
				取消
			</Button>
		</div>
	</>
);

const FileCard: Component<{
	item: FileItem;
	editing: boolean;
	highlighted: boolean;
	selectMode: boolean;
	selected: boolean;
	onToggleSelect: (storedId: string) => void;
	editName: string;
	onOpen: () => void;
	onZoom?: () => void;
	onContextMenu: (item: FileItem, e: MouseEvent) => void;
	onStartRename: (item: FileItem) => void;
	onDelete: (stored_id: string) => void;
	onRename: () => void;
	onEditName: (value: string) => void;
	onCancelEdit: () => void;
}> = (props) => (
	// biome-ignore lint/a11y/noStaticElementInteractions: 右键菜单为附加操作，键盘用户走卡片内按钮
	<div
		onContextMenu={(e) => props.onContextMenu(props.item, e)}
		class={styles.card}
		classList={{
			[styles.cardHighlight]: props.highlighted,
			[styles.cardSelected]: props.selected,
		}}
		data-file-id={props.item.stored_id}
	>
		<Show when={props.selectMode}>
			<label class={styles.selectBox}>
				<input
					type="checkbox"
					checked={props.selected}
					onChange={() => props.onToggleSelect(props.item.stored_id)}
					aria-label={`选择 ${props.item.original_name}`}
				/>
			</label>
		</Show>
		<FilePreview
			item={props.item}
			onOpen={props.onOpen}
			onZoom={props.onZoom}
		/>
		<Show
			when={props.editing}
			fallback={
				<FileCardView
					item={props.item}
					onOpen={props.onOpen}
					onStartRename={props.onStartRename}
					onDelete={props.onDelete}
				/>
			}
		>
			<FileCardEdit
				item={props.item}
				editName={props.editName}
				onEditName={props.onEditName}
				onRename={props.onRename}
				onCancelEdit={props.onCancelEdit}
			/>
		</Show>
	</div>
);

export default FileCard;
