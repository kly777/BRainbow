import { Button, Tooltip } from "@components/ui";
import { Copy, Lock } from "@components/ui/icons";
import { copyTextWithToast, fmtLocal, formatBytes } from "@shared/utils";
import { type Component, For, Show } from "solid-js";
import type { FileItem } from "../api.ts";
import styles from "../FileList.module.css";
import { categoryLabel } from "../lib/category.ts";
import { fmtDimensions, fmtDurationMs } from "../lib/meta.ts";
import { canZoom } from "../lib/thumbnail.ts";
import { FileThumb } from "./FileThumb.tsx";

/** 列表视图的一行：徽章/缩略图 + 文件名 + 元信息 + 操作 */
const FileRow: Component<{
	item: FileItem;
	highlighted: boolean;
	selectMode: boolean;
	selected: boolean;
	onToggleSelect: (storedId: string) => void;
	onOpen: () => void;
	onZoom: () => void;
	onContextMenu: (item: FileItem, e: MouseEvent) => void;
	onStartRename: (item: FileItem) => void;
	onDelete: (stored_id: string) => void;
}> = (props) => (
	// biome-ignore lint/a11y/noStaticElementInteractions: 右键菜单为附加操作，键盘用户走行内按钮
	<div
		onContextMenu={(e) => props.onContextMenu(props.item, e)}
		class={styles.row}
		classList={{
			[styles.rowHighlight]: props.highlighted,
			[styles.rowSelected]: props.selected,
		}}
		data-file-id={props.item.stored_id}
	>
		<Show when={props.selectMode}>
			<input
				type="checkbox"
				class={styles.rowCheck}
				checked={props.selected}
				onChange={() => props.onToggleSelect(props.item.stored_id)}
				aria-label={`选择 ${props.item.original_name}`}
			/>
		</Show>
		<button
			type="button"
			class={styles.rowThumb}
			onClick={() => (canZoom(props.item) ? props.onZoom() : props.onOpen())}
			title={canZoom(props.item) ? "放大查看" : "查看详情"}
		>
			<FileThumb
				item={props.item}
				imgClass={styles.rowThumbImg}
				missingText="缺失"
				lockOnly
			/>
		</button>

		<div class={styles.rowMain}>
			<Tooltip label={props.item.original_name} class={styles.nameTipHost}>
				<button type="button" class={styles.nameBtn} onClick={props.onOpen}>
					{props.item.original_name}
				</button>
			</Tooltip>
			<div class={styles.rowMeta}>
				<Show when={props.item.missing}>
					<span class={styles.missingTag}>文件缺失</span>
				</Show>
				<Show when={props.item.is_private}>
					<span class={styles.privateTagInline}>
						<Lock size={11} /> 私密
					</span>
				</Show>
				<span>{categoryLabel(props.item.file_category)}</span>
				<span>·</span>
				<span>{formatBytes(props.item.size_bytes)}</span>
				<Show when={fmtDimensions(props.item.width, props.item.height)}>
					{(dims) => (
						<>
							<span>·</span>
							<span>{dims()}</span>
						</>
					)}
				</Show>
				<Show when={fmtDurationMs(props.item.duration_ms)}>
					{(duration) => (
						<>
							<span>·</span>
							<span>{duration()}</span>
						</>
					)}
				</Show>
				<span>·</span>
				<span>{fmtLocal(props.item.created_at)}</span>
				<Show when={props.item.tags.length > 0}>
					<For each={props.item.tags}>
						{(tag) => <span class={styles.tag}>#{tag}</span>}
					</For>
				</Show>
			</div>
		</div>

		<div class={styles.rowActions}>
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
	</div>
);

export default FileRow;
