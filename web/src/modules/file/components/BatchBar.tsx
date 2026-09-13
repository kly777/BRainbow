import { Button, Input } from "@components/ui";
import { type Component, createSignal, Show } from "solid-js";
import styles from "../FileList.module.css";

/** 批量操作工具栏（选择模式下固定底部） */
const BatchBar: Component<{
	count: number;
	total: number;
	onSelectAll: () => void;
	onClear: () => void;
	onAddTag: (tag: string) => Promise<void>;
	onCopyLinks: () => Promise<void>;
	onDelete: () => Promise<void>;
}> = (props) => {
	const [tag, setTag] = createSignal("");
	const submitTag = async () => {
		const name = tag().trim();
		if (!name) return;
		await props.onAddTag(name);
		setTag("");
	};
	return (
		<Show when={props.count > 0}>
			<div class={styles.batchBar}>
				<span class={styles.batchCount}>
					已选 {props.count} / {props.total}
				</span>
				<Button
					variant="ghost"
					size="sm"
					onClick={props.onSelectAll}
					disabled={props.count === props.total}
				>
					全选本页
				</Button>
				<Button variant="ghost" size="sm" onClick={props.onClear}>
					取消选择
				</Button>

				<div class={styles.batchTag}>
					<Input
						class={styles.batchTagInput}
						placeholder="加标签…"
						value={tag()}
						onInput={(e) => setTag(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") void submitTag();
						}}
						aria-label="为已选文件加标签"
					/>
					<Button
						variant="secondary"
						size="sm"
						onClick={submitTag}
						disabled={!tag().trim()}
					>
						应用
					</Button>
				</div>

				<Button variant="secondary" size="sm" onClick={props.onCopyLinks}>
					复制链接
				</Button>
				<Button variant="danger" size="sm" onClick={props.onDelete}>
					删除
				</Button>
			</div>
		</Show>
	);
};

export default BatchBar;
