// ── /bookmark 列表项：favicon + 标题链接 + 域名 + 标签 + 操作 ──

import { Button, Tooltip } from "@components/ui";
import type { Bookmark } from "@modules/bookmark";
import { For } from "solid-js";
import styles from "../BookmarkPage.module.css";
import Favicon from "./Favicon.tsx";

/** 从 URL 提取域名（用于展示与标题兜底） */
function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

export function BookmarkItem(props: {
	bm: Bookmark;
	onEdit: () => void;
	onDelete: () => void;
	onTagFilter: (tag: string) => void;
}) {
	const { bm } = props;
	return (
		<div class={styles.item}>
			<Favicon url={bm.url} letter={extractDomain(bm.url)} />
			<a
				class={styles.itemTitle}
				href={bm.url}
				target="_blank"
				rel="noopener noreferrer"
				title={bm.title}
			>
				{bm.title}
			</a>
			<div class={styles.itemUrl} title={bm.url}>
				{extractDomain(bm.url)}
			</div>
			<div class={styles.itemTags}>
				<For each={bm.tags}>
					{(tag) => (
						<button
							type="button"
							class={styles.itemTag}
							title={`按标签「${tag}」过滤`}
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								props.onTagFilter(tag);
							}}
						>
							#{tag}
						</button>
					)}
				</For>
			</div>
			<div class={styles.itemActions}>
				<Tooltip label="编辑">
					<Button variant="icon" onClick={props.onEdit}>
						✎
					</Button>
				</Tooltip>
				<Tooltip label="删除">
					<Button variant="icon" onClick={props.onDelete}>
						✕
					</Button>
				</Tooltip>
			</div>
		</div>
	);
}
