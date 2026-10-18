/**
 * 文件库空态引导：首次进入或筛选无结果时，告诉用户可以怎么把文件放进来。
 */

import Button from "@components/ui/atoms/Button.tsx";
import { Upload } from "@components/ui/icons";
import { type Component, Show } from "solid-js";
import styles from "./EmptyGuide.module.css";

const EmptyGuide: Component<{ filtered: boolean; onUpload: () => void }> = (
	props,
) => (
	<div class={styles.wrap}>
		<Show
			when={!props.filtered}
			fallback={<p class={styles.text}>当前筛选条件下没有匹配的文件</p>}
		>
			<Upload size={32} class={styles.icon} />
			<p class={styles.title}>文件库还是空的</p>
			<ul class={styles.hints}>
				<li>把文件拖到页面任意位置即可上传</li>
				<li>
					直接 <kbd class={styles.kbd}>Ctrl</kbd> +{" "}
					<kbd class={styles.kbd}>V</kbd> 粘贴截图或复制的文件
				</li>
				<li>一次可选择多个文件批量上传</li>
			</ul>
			<Button variant="primary" class={styles.cta} onClick={props.onUpload}>
				选择文件上传
			</Button>
		</Show>
	</div>
);

export default EmptyGuide;
