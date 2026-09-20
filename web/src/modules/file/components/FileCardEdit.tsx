import { Button, Input } from "@components/ui";
import { Show } from "solid-js";
import type { FileItem } from "../api.ts";
import styles from "../FileList.module.css";
import FileMeta from "./FileMeta.tsx";
import FileTags from "./FileTags.tsx";

/**
 * 卡片编辑态：改名输入框 + 保存 / 取消。
 *
 * 信息区与标签行**刻意保留**：与展示态结构一致，切换时卡片高度才不跳变。
 */
export default function FileCardEdit(props: {
	item: FileItem;
	editName: string;
	onEditName: (value: string) => void;
	onRename: () => void;
	onCancelEdit: () => void;
}) {
	return (
		<>
			<div class={styles.info}>
				<Input
					value={props.editName}
					onInput={(e) => props.onEditName(e.currentTarget.value)}
					class={styles.editInput}
					onKeyPress={(e) => e.key === "Enter" && props.onRename()}
					aria-label="文件名称"
				/>
				<FileMeta item={props.item} />
				<Show when={props.item.tags.length > 0}>
					<div class={styles.tags}>
						<FileTags tags={props.item.tags} />
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
}
