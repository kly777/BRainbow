import { Button } from "@components/ui";
import { Copy } from "@components/ui/icons";
import { copyTextWithToast } from "@shared/utils";
import { Show } from "solid-js";
import type { FileItem } from "../api.ts";

/**
 * 文件条目的操作区：复制 URL（常驻）+ 重命名 / 删除（需 `can_edit`）。
 *
 * 卡片视图与列表视图此前各写一份、逐字相同（含按钮的 title 文案与图标尺寸），
 * 改一处得记得改两处。容器类由调用方给（两处的间距与分隔线不同）。
 */
export default function FileItemActions(props: {
	item: FileItem;
	class?: string;
	onStartRename: (item: FileItem) => void;
	onDelete: (storedId: string) => void;
}) {
	return (
		<div class={props.class}>
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
	);
}
