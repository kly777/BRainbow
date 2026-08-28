// ── /bookmark：按标签分组展示书签（默认视图） ──

import { Button, LoadingSkeleton, PageHead, SearchInput } from "@components/ui";
import { Settings, X } from "@components/ui/icons";
import { PATHS } from "@config/paths";
import { getErrorMessage } from "@shared/api";
import { trySync } from "@shared/utils";
import { useNavigate } from "@solidjs/router";
import {
	type Component,
	createEffect,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import type { Bookmark, GroupedBookmarksResponse } from "./api.ts";
import {
	getGroupedBookmarksE,
	incrementBookmarkVisitE,
	searchBookmarksE,
} from "./api.ts";
import styles from "./BookmarkPage.module.css";
import Favicon from "./components/Favicon.tsx";

function extractDomain(url: string): string {
	const result = trySync(() => new URL(url).hostname.replace(/^www\./, ""));
	return result.ok ? result.value : url;
}

const BookmarkLink: Component<{ bm: Bookmark }> = (props) => {
	const handleClick = () => {
		// 异步记录访问，不阻塞跳转
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
};

const TagGroupCard: Component<{
	tag: string;
	totalVisits: number;
	bookmarks: Bookmark[];
}> = (props) => (
	<div class={styles.tagGroup}>
		<div class={styles.tagGroupHeader}>
			<span class={styles.tagGroupName}>#{props.tag}</span>
			<span class={styles.tagGroupMeta}>
				{props.bookmarks.length} 个书签
				<Show when={props.totalVisits > 0}> · {props.totalVisits} 次访问</Show>
			</span>
		</div>
		<div class={styles.tagGroupList}>
			<For each={props.bookmarks}>{(bm) => <BookmarkLink bm={bm} />}</For>
		</div>
	</div>
);

export default function BookmarkPage() {
	const navigate = useNavigate();
	const [searchQuery, setSearchQuery] = createSignal("");
	const [searchResults, setSearchResults] = createSignal<Bookmark[] | null>(
		null,
	);
	const [searching, setSearching] = createSignal(false);
	const [searchError, setSearchError] = createSignal<string | null>(null);

	const [grouped, { refetch }] = createResource(() => getGroupedBookmarksE());

	// 搜索模式（不闪烁：保留旧结果直到新结果到达）
	let searchSeq = 0;
	async function handleSearch(q: string) {
		setSearchQuery(q);
		if (!q.trim()) {
			setSearchResults(null);
			setSearchError(null);
			return;
		}
		const seq = ++searchSeq;
		setSearching(true);
		setSearchError(null);
		try {
			const res = await searchBookmarksE(q.trim(), 1, 200);
			if (seq !== searchSeq) return;
			setSearchResults(res.items);
		} catch (e: unknown) {
			if (seq !== searchSeq) return;
			setSearchError(e instanceof Error ? e.message : "搜索失败");
		}
		setSearching(false);
	}

	return (
		<div class={styles.page}>
			<PageHead
				title="网页书签"
				actions={
					<>
						<SearchInput
							value={searchQuery()}
							onSearch={handleSearch}
							placeholder="搜索标题 / URL / 备注 / 标签…"
						/>
						<Show when={searchQuery().trim()}>
							<Button
								variant="icon"
								title="清空搜索"
								onClick={() => handleSearch("")}
							>
								<X size={14} />
							</Button>
						</Show>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => navigate(PATHS.bookmarkManage)}
						>
							<Settings size={14} /> 管理
						</Button>
					</>
				}
			/>

			{/* 搜索结果（无闪烁：搜索中保留旧结果，仅首次显示加载态） */}
			<Show when={searchResults() !== null}>
				<Show when={searchError()}>
					<div class={styles.state}>
						<p class={styles.errorText}>{searchError()}</p>
					</div>
				</Show>
				<Show when={!searchError()}>
					<div class={styles.searchResults}>
						<div class={styles.searchResultsHeader}>
							搜索结果：{searchResults()?.length ?? 0} 条
							<Show when={searching()}>
								<span class={styles.searchUpdating}> 更新中…</span>
							</Show>
						</div>
						<div class={styles.list}>
							<For each={searchResults() ?? []}>
								{(bm) => <BookmarkLink bm={bm} />}
							</For>
						</div>
					</div>
				</Show>
			</Show>

			{/* 分组展示 */}
			<Show when={searchResults() === null}>
				<Show when={grouped.loading}>
					<LoadingSkeleton />
				</Show>
				<Show when={grouped.error}>
					<div class={styles.state}>
						<p class={styles.errorText}>
							加载失败：{getErrorMessage(grouped.error)}
						</p>
						<Button variant="secondary" size="sm" onClick={() => refetch()}>
							重试
						</Button>
					</div>
				</Show>
				<Show when={grouped()}>
					{(data) => (
						<div class={styles.groupsContainer}>
							<For each={data().groups.filter((g) => g.bookmarks.length > 2)}>
								{(group) => (
									<TagGroupCard
										tag={group.tag}
										totalVisits={group.total_visits}
										bookmarks={group.bookmarks}
									/>
								)}
							</For>
							<Show when={data().untagged.length > 0}>
								<TagGroupCard
									tag="未分类"
									totalVisits={0}
									bookmarks={data().untagged}
								/>
							</Show>
							<Show
								when={
									data().groups.length === 0 && data().untagged.length === 0
								}
							>
								<div class={styles.state}>
									还没有书签，点击右上角"管理"按钮添加第一个吧！
								</div>
							</Show>
						</div>
					)}
				</Show>
			</Show>
		</div>
	);
}
