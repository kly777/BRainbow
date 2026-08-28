// ── /bookmark 列表项：checkbox + favicon + 标题链接 + 域名 + 标签 + 操作 ──

import { Button, Tooltip } from "@components/ui";
import type { Bookmark } from "@modules/bookmark";
import { trySync } from "@shared/utils";
import { createSignal, For, Show } from "solid-js";
import styles from "../BookmarkPage.module.css";
import Favicon from "./Favicon.tsx";

/** 从 URL 提取域名（用于展示与标题兜底） */
function extractDomain(url: string): string {
	const result = trySync(() => new URL(url).hostname.replace(/^www\./, ""));
	return result.ok ? result.value : url;
}

export function BookmarkItem(props: {
	bm: Bookmark;
	selected: boolean;
	onToggleSelect: () => void;
	onEdit: () => void;
onDelete: () => void;
	onTagFilter: (tag: string) => void;
	onRefreshTitle: () => void;
	onCheckAccessibility: () => void;
}) {
	const { bm } = props;
	const [accessibility, setAccessibility] = createSignal<"unknown" | "ok" | "fail">("unknown");
	const [checking, setChecking] = createSignal(false);
	const [refreshing, setRefreshing] = createSignal(false);

	const handleCheckAccessibility = async () => {
		setChecking(true);
		await props.onCheckAccessibility();
		// The parent will handle the actual check; this is just UI feedback
		setChecking(false);
	};

	return (
		<div class={`${styles.item} ${props.selected ? styles.itemSelected : ""}`}>
			<input
				type="checkbox"
				class={styles.itemCheckbox}
				checked={props.selected}
				onChange={props.onToggleSelect}
				aria-label={`选择书签 ${bm.title}`}
			/>
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
				<Tooltip label="刷新标题">
					<Button variant="icon" onClick={props.onRefreshTitle} disabled={refreshing()}>
						{refreshing() ? "⏳" : "🔄"}
					</Button>
				</Tooltip>
				<Tooltip label="检测可访问性">
					<Button variant="icon" onClick={handleCheckAccessibility} disabled={checking()}>
						{checking() ? "⏳" : accessibility() === "ok" ? "✅" : accessibility() === "fail" ? "❌" : "🔗"}
					</Button>
				</Tooltip>
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
