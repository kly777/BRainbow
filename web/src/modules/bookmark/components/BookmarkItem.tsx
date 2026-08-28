// ── /bookmark 列表项：checkbox + favicon + 标题链接 + 域名 + 标签 + 操作 ──

import { Button, Tooltip } from "@components/ui";
import type { Bookmark } from "@modules/bookmark";
import { setBookmarkTagsE, suggestBookmarkTagsE } from "@modules/bookmark";
import { notifyError, notifySuccess, trySync } from "@shared/utils";
import { createSignal, For, Show } from "solid-js";
import styles from "../BookmarkPage.module.css";
import Favicon from "./Favicon.tsx";
import {
	IconCheckCircle,
	IconLink,
	IconLoader,
	IconPencil,
	IconRefresh,
	IconSparkles,
	IconX,
	IconXCircle,
} from "./icons.tsx";

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
	/** 标签变更后通知父组件刷新 */
	onTagsChanged?: () => void;
}) {
	const { bm } = props;
	const [accessibility, setAccessibility] = createSignal<"unknown" | "ok" | "fail">("unknown");
	const [checking, setChecking] = createSignal(false);
	const [refreshing, setRefreshing] = createSignal(false);

	// AI 标签建议状态
	const [suggesting, setSuggesting] = createSignal(false);
	const [suggestedTags, setSuggestedTags] = createSignal<string[]>([]);
	const [selectedSuggested, setSelectedSuggested] = createSignal<Set<string>>(new Set<string>());

	const handleCheckAccessibility = async () => {
		setChecking(true);
		await props.onCheckAccessibility();
		setChecking(false);
	};

	/** AI 建议标签 */
	const handleSuggestTags = async () => {
		setSuggesting(true);
		setSuggestedTags([]);
		setSelectedSuggested(new Set<string>());
		try {
			const result = await suggestBookmarkTagsE(bm.id);
			const existing = new Set(bm.tags);
			const newTags = result.tags.filter((t) => !existing.has(t));
			setSuggestedTags(newTags);
			// 默认全选
			setSelectedSuggested(new Set(newTags));
			if (newTags.length === 0) {
				notifySuccess("AI 建议的标签都已存在");
			}
		} catch (e: unknown) {
			notifyError("AI 标签建议失败", e instanceof Error ? e : new Error(String(e)));
		}
		setSuggesting(false);
	};

	/** 切换建议标签的选中状态 */
	const toggleSuggested = (tag: string) => {
		setSelectedSuggested((prev) => {
			const next = new Set(prev);
			if (next.has(tag)) {
				next.delete(tag);
			} else {
				next.add(tag);
			}
			return next;
		});
	};

	/** 批量添加选中的建议标签 */
	const addSelectedTags = async () => {
		const toAdd = Array.from(selectedSuggested());
		if (toAdd.length === 0) return;
		const newTags = [...bm.tags, ...toAdd];
		try {
			await setBookmarkTagsE(bm.id, newTags);
			setSuggestedTags([]);
			setSelectedSuggested(new Set<string>());
			notifySuccess(`已添加 ${toAdd.length} 个标签`);
			props.onTagsChanged?.();
		} catch (e: unknown) {
			notifyError("添加标签失败", e instanceof Error ? e : new Error(String(e)));
		}
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
			<div class={styles.itemContent}>
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
				<Show when={suggestedTags().length > 0}>
					<div class={styles.suggestInline}>
						<span class={styles.suggestLabel}>AI：</span>
						<For each={suggestedTags()}>
							{(tag) => (
								<button
									type="button"
									class={`${styles.suggestTagBtn} ${selectedSuggested().has(tag) ? styles.suggestTagSelected : ""}`}
									onClick={(e) => {
										e.preventDefault();
										e.stopPropagation();
										toggleSuggested(tag);
									}}
								>
									{tag}
								</button>
							)}
						</For>
						<Button
							variant="primary"
							size="sm"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								addSelectedTags();
							}}
							disabled={selectedSuggested().size === 0}
						>
							添加 ({selectedSuggested().size})
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								setSuggestedTags([]);
								setSelectedSuggested(new Set<string>());
							}}
						>
							<IconX size={14} />
						</Button>
					</div>
				</Show>
			</div>
			<div class={styles.itemActions}>
				<Tooltip label="AI 标签">
					<Button variant="icon" onClick={handleSuggestTags} disabled={suggesting()}>
						{suggesting() ? <IconLoader size={16} /> : <IconSparkles size={16} />}
					</Button>
				</Tooltip>
				<Tooltip label="刷新标题">
					<Button variant="icon" onClick={props.onRefreshTitle} disabled={refreshing()}>
						{refreshing() ? <IconLoader size={16} /> : <IconRefresh size={16} />}
					</Button>
				</Tooltip>
				<Tooltip label="检测可访问性">
					<Button variant="icon" onClick={handleCheckAccessibility} disabled={checking()}>
						{checking() ? <IconLoader size={16} /> : accessibility() === "ok" ? <IconCheckCircle size={16} /> : accessibility() === "fail" ? <IconXCircle size={16} /> : <IconLink size={16} />}
					</Button>
				</Tooltip>
				<Tooltip label="编辑">
					<Button variant="icon" onClick={props.onEdit}>
						<IconPencil size={16} />
					</Button>
				</Tooltip>
				<Tooltip label="删除">
					<Button variant="icon" onClick={props.onDelete}>
						<IconX size={16} />
					</Button>
				</Tooltip>
			</div>
		</div>
	);
}
