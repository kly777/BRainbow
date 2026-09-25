// 分组视图里的书签条目与标签分组卡（从 BookmarkPage.tsx 下钻）

import { For, Show } from "solid-js";
import type { Bookmark } from "../api.ts";
import { incrementBookmarkVisitE } from "../api.ts";
import styles from "../BookmarkPage.module.css";
import { extractDomain } from "../lib/url.ts";
import Favicon from "./Favicon.tsx";

/** 单条书签：favicon + 标题 + 访问次数角标；点击异步记一次访问（不阻塞跳转） */
export function BookmarkLink(props: { bm: Bookmark }) {
	const handleClick = () => {
		void incrementBookmarkVisitE(props.bm.id);
	};

	return (
		<a
			class={styles.groupItem}
			href={props.bm.url}
			target="_blank"
			rel="noopener noreferrer"
			onClick={handleClick}
			title={`${props.bm.title}\n${props.bm.url}`}
		>
			<Favicon url={props.bm.url} letter={extractDomain(props.bm.url)} />
			<span class={styles.groupItemTitle}>{props.bm.title}</span>
			<Show when={props.bm.visit_count > 0}>
				<span class={styles.visitBadge}>{props.bm.visit_count}</span>
			</Show>
		</a>
	);
}

export interface TagGroupCardProps {
	tag: string;
	totalVisits: number;
	bookmarks: Bookmark[];
}

/** 一个标签下的书签分组 */
export default function TagGroupCard(props: TagGroupCardProps) {
	return (
		<div class={styles.tagGroup}>
			<div class={styles.tagGroupHeader}>
				<span class={styles.tagGroupName}>#{props.tag}</span>
				<span class={styles.tagGroupMeta}>
					{props.bookmarks.length} 个书签
					<Show when={props.totalVisits > 0}>
						{" "}
						· {props.totalVisits} 次访问
					</Show>
				</span>
			</div>
			<div class={styles.tagGroupList}>
				<For each={props.bookmarks}>{(bm) => <BookmarkLink bm={bm} />}</For>
			</div>
		</div>
	);
}
