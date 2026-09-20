import { For } from "solid-js";
import styles from "../FileList.module.css";

/**
 * 标签行：#tag chips。
 *
 * 只渲染 chips 本身、不带包装元素 —— 调用方各自的容器不同（卡片里是带下边距的
 * `.tags`，列表视图里是行内元信息的一部分），套一层就会改变它们的换行与间距。
 */
export default function FileTags(props: { tags: readonly string[] }) {
	return (
		<For each={props.tags}>
			{(tag) => <span class={styles.tag}>#{tag}</span>}
		</For>
	);
}
