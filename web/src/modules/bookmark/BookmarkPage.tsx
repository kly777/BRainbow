// ── /bookmark：按标签分组展示书签（默认视图） ──

import {
	Button,
	ErrorRetry,
	LoadingSkeleton,
	PageHead,
	SearchInput,
} from "@components/ui";
import { Settings, X } from "@components/ui/icons";
import { PATHS } from "@config/paths";
import { useNavigate } from "@solidjs/router";
import { type Component, createResource, For, Show } from "solid-js";
import type { Bookmark } from "./api.ts";
import { getGroupedBookmarksE, incrementBookmarkVisitE } from "./api.ts";
import styles from "./BookmarkPage.module.css";
import Favicon from "./components/Favicon.tsx";
import { useBookmarkSearch } from "./hooks/useBookmarkSearch.ts";
import { extractDomain } from "./lib/url.ts";

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
	// 搜索态（输入文本 + 结果 + 更新中/错误）收在 hook 里，见其文件头的契约说明
	const s = useBookmarkSearch();

	const [grouped, { refetch }] = createResource(() => getGroupedBookmarksE());

	return (
		<div class={styles.page}>
			<PageHead
				title="网页书签"
				actions={
					<>
						<SearchInput
							value={s.query()}
							onSearch={s.setQuery}
							placeholder="搜索标题 / URL / 备注 / 标签…"
						/>
						<Show when={s.query().trim()}>
							<Button
								variant="icon"
								title="清空搜索"
								onClick={() => s.setQuery("")}
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
			<Show when={s.results() !== null}>
				<Show when={s.error()}>
					<div class={styles.state}>
						<p class={styles.errorText}>{s.error()}</p>
					</div>
				</Show>
				<Show when={!s.error()}>
					<div class={styles.searchResults}>
						<div class={styles.searchResultsHeader}>
							搜索结果：{s.results()?.length ?? 0} 条
							<Show when={s.updating()}>
								<span class={styles.searchUpdating}> 更新中…</span>
							</Show>
						</div>
						<div class={styles.list}>
							<For each={s.results() ?? []}>
								{(bm) => <BookmarkLink bm={bm} />}
							</For>
						</div>
					</div>
				</Show>
			</Show>

			{/* 分组展示 */}
			<Show when={s.results() === null}>
				<Show when={grouped.loading}>
					<LoadingSkeleton />
				</Show>
				<Show when={grouped.error}>
					<ErrorRetry error={grouped.error} onRetry={() => refetch()} />
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
