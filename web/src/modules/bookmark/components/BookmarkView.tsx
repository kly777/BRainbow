import { fmtLocal } from "@shared/utils";
import { type Component, For } from "solid-js";
import styles from "../BookmarkDetail.module.css";
import type { BookmarkItem } from "../hooks/useBookmarkDetail.ts";

/** 书签详情的查看态：标题（页面唯一的 h1）/ URL / 时间 / 备注 / 标签 */
export const BookmarkView: Component<{ bm: BookmarkItem }> = (props) => (
	<>
		<h1 class={styles.title}>{props.bm.title}</h1>
		<a
			class={styles.url}
			href={props.bm.url}
			target="_blank"
			rel="noopener noreferrer"
		>
			{props.bm.url}
		</a>
		<div class={styles.meta}>
			<span>
				创建于 {fmtLocal(props.bm.created_at)} · 更新于{" "}
				{fmtLocal(props.bm.updated_at)}
			</span>
		</div>
		<p class={styles.description}>{props.bm.description || "暂无备注"}</p>
		<div class={styles.tags}>
			<For each={props.bm.tags}>
				{(t) => <span class={styles.tag}>#{t}</span>}
			</For>
		</div>
	</>
);

export default BookmarkView;
