import { type Component, Show } from "solid-js";
import type { FileItem } from "../api.ts";
import styles from "../FileList.module.css";
import { canZoom } from "../lib/thumbnail.ts";
import FileCardEdit from "./FileCardEdit.tsx";
import FileCardView from "./FileCardView.tsx";
import { FileThumb } from "./FileThumb.tsx";

/** 缩略图按钮：可放大的进灯箱，其余进详情页 */
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
		<FileThumb
			item={props.item}
			imgClass={styles.thumb}
			durationBadge
			// 网格列宽：minmax(15rem, 1fr)；≤600px 时两列（各约 45vw）
			sizes="(max-width: 600px) 45vw, 260px"
		/>
	</button>
);

/** 卡片上的操作收成一束（刀法 ②）：此前 9 个回调平铺，加一个要改调用点与两层子件 */
export interface FileCardActions {
	onToggleSelect: (storedId: string) => void;
	onOpen: () => void;
	onZoom?: () => void;
	onContextMenu: (item: FileItem, e: MouseEvent) => void;
	onStartRename: (item: FileItem) => void;
	onDelete: (storedId: string) => void;
	onRename: () => void;
	onEditName: (value: string) => void;
	onCancelEdit: () => void;
}

/**
 * 网格视图的文件卡片：缩略图 + 展示态/编辑态（`editing` 切换）+ 选中框。
 * 两个模式各自实现在 FileCardView / FileCardEdit，这里只做组合与状态类。
 */
const FileCard: Component<{
	item: FileItem;
	editing: boolean;
	highlighted: boolean;
	selectMode: boolean;
	selected: boolean;
	editName: string;
	actions: FileCardActions;
}> = (props) => (
	// biome-ignore lint/a11y/noStaticElementInteractions: 右键菜单为附加操作，键盘用户走卡片内按钮
	<div
		onContextMenu={(e) => props.actions.onContextMenu(props.item, e)}
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
					onChange={() => props.actions.onToggleSelect(props.item.stored_id)}
					aria-label={`选择 ${props.item.original_name}`}
				/>
			</label>
		</Show>
		<FilePreview
			item={props.item}
			onOpen={props.actions.onOpen}
			onZoom={props.actions.onZoom}
		/>
		<Show
			when={props.editing}
			fallback={
				<FileCardView
					item={props.item}
					onOpen={props.actions.onOpen}
					onStartRename={props.actions.onStartRename}
					onDelete={props.actions.onDelete}
				/>
			}
		>
			<FileCardEdit
				item={props.item}
				editName={props.editName}
				onEditName={props.actions.onEditName}
				onRename={props.actions.onRename}
				onCancelEdit={props.actions.onCancelEdit}
			/>
		</Show>
	</div>
);

export default FileCard;
