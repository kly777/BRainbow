import { Button, Input } from "@components/ui";
import { isImeComposing } from "@shared/utils";
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
					// 用 keydown 而不是过时的 keypress：组字中的回车（选候选词）要被挡掉，
					// 否则中文改名会提交成没打完的拼音
					onKeyDown={(e) => {
						if (isImeComposing(e)) return;
						if (e.key === "Enter") props.onRename();
					}}
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
