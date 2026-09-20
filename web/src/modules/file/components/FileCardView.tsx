import { Tooltip } from "@components/ui";
import { Lock } from "@components/ui/icons";
import { Show } from "solid-js";
import type { FileItem } from "../api.ts";
import styles from "../FileList.module.css";
import FileItemActions from "./FileItemActions.tsx";
import FileMeta from "./FileMeta.tsx";
import FileTags from "./FileTags.tsx";

/** 卡片展示态：文件名 + 私密标记 + 元信息 + 标签 + 操作区 */
export default function FileCardView(props: {
	item: FileItem;
	onOpen: () => void;
	onStartRename: (item: FileItem) => void;
	onDelete: (storedId: string) => void;
}) {
	return (
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
						<FileTags tags={props.item.tags} />
					</div>
				</Show>
			</div>
			<FileItemActions
				item={props.item}
				class={styles.actions}
				onStartRename={props.onStartRename}
				onDelete={props.onDelete}
			/>
		</>
	);
}
