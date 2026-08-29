// ── /bookmark：网页书签管理（搜索 / 标签过滤 / 分页 / 导入 Firefox 书签 / 批量管理） ──

import { Button, ErrorRetry, LoadingSkeleton, PageHead, SearchInput, SimplePagination } from "@components/ui";
import { Sparkles, X } from "@components/ui/icons";
import { type Component, For, Show } from "solid-js";
import styles from "./BookmarkPage.module.css";
import { BookmarkFormModal } from "./components/BookmarkFormModal.tsx";
import { BookmarkItem } from "./components/BookmarkItem.tsx";
import TagFilter from "./components/TagFilter.tsx";
import TagManager from "./components/TagManager.tsx";
import { useBookmarkPage } from "./hooks/useBookmarkPage.ts";

const BatchBar: Component<{
	b: ReturnType<typeof useBookmarkPage>;
}> = (props) => {
	const b = props.b;
	const count = () => b.selectedIds().size;

	return (
		<Show when={count() > 0}>
			<div class={styles.batchBar}>
				<span class={styles.batchInfo}>已选 {count()} 个书签</span>
				<div class={styles.batchActions}>
					<Button
						variant="secondary"
						size="sm"
						onClick={b.handleBatchAiTag}
						disabled={b.batchTagging()}
					>
						{b.batchTagging() ? (
							"AI 标签中..."
						) : (
							<>
								<Sparkles size={14} /> AI 批量标签
							</>
						)}
					</Button>
					<Button variant="secondary" size="sm" onClick={b.clearSelection}>
						取消选择
					</Button>
					<Button variant="danger" size="sm" onClick={b.handleBatchDelete}>
						批量删除
					</Button>
				</div>
			</div>
		</Show>
	);
};

const BookmarkMainSection: Component<{
	b: ReturnType<typeof useBookmarkPage>;
}> = (props) => {
	const b = props.b;

	return (
		<Show
			when={b.bookmarks().length > 0}
			fallback={
				<div class={styles.state}>
					{b.searchQuery().trim() || b.tagFilter()
						? "没有找到匹配的书签"
						: "还没有书签，点击上方按钮添加第一个吧！"}
				</div>
			}
		>
			<BatchBar b={b} />
			<div class={styles.listHeader}>
				<input
					type="checkbox"
					class={styles.itemCheckbox}
					checked={b.isAllSelected()}
					onChange={b.toggleSelectAll}
					aria-label="全选/取消全选"
				/>
				<span class={styles.listHeaderLabel}>全选</span>
			</div>
			<div class={styles.list}>
				<For each={b.bookmarks()}>
					{(bm) => (
						<BookmarkItem
							bm={bm}
							selected={b.selectedIds().has(bm.id)}
							onToggleSelect={() => b.toggleSelect(bm.id)}
							onEdit={() => b.openEdit(bm)}
							onDelete={() => b.handleDelete(bm)}
							onTagFilter={b.handleTagFilter}
							onRefreshTitle={() => b.handleRefreshTitle(bm)}
							onCheckAccessibility={() => b.handleCheckAccessibility(bm)}
							onTagsChanged={() => b.load({ silent: true })}
						/>
					)}
				</For>
			</div>

				<SimplePagination
					page={b.page()}
					totalPages={b.totalPages()}
					total={b.total()}
					onPrev={() => b.goPage(b.page() - 1)}
					onNext={() => b.goPage(b.page() + 1)}
				/>
		</Show>
	);
};

export default function BookmarkPage() {
	const b = useBookmarkPage();

	return (
		<div class={styles.page}>
			<PageHead
				title="网页书签"
				actions={
					<>
						<SearchInput
							value={b.searchQuery()}
							onSearch={b.handleSearch}
							placeholder="搜索标题 / URL / 备注 / 标签…"
						/>
						<Show when={b.searchQuery().trim()}>
							<Button
								variant="icon"
								title="清空搜索"
								onClick={() => b.handleSearch("")}
							>
								<X size={14} />
							</Button>
						</Show>
						<TagFilter value={b.tagFilter()} onChange={b.handleTagFilter} />
						<Button
							variant="secondary"
							size="sm"
							onClick={() =>
								document.getElementById("bookmark-import-input")?.click()
							}
							disabled={b.importing()}
						>
							{b.importing() ? "导入中..." : "导入"}
						</Button>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => b.setTagManagerOpen(true)}
						>
							标签管理
						</Button>
						<Button variant="primary" size="sm" onClick={b.openCreate}>
							＋ 新建书签
						</Button>
					</>
				}
			/>
			<input
				id="bookmark-import-input"
				type="file"
				accept=".html,.htm,text/html"
				style={{ display: "none" }}
				onChange={(e) => {
					b.handleImportFile(e.currentTarget.files?.[0]);
					e.currentTarget.value = "";
				}}
			/>

			<Show when={b.loading()}>
				<LoadingSkeleton />
			</Show>
			<Show when={b.error()}>
				<ErrorRetry error={b.error()} onRetry={() => b.load()} />
			</Show>

			<Show when={!b.loading() && !b.error()}>
				<BookmarkMainSection b={b} />
			</Show>

			<BookmarkFormModal b={b} />

			<TagManager
				isOpen={b.tagManagerOpen()}
				onClose={() => b.setTagManagerOpen(false)}
				onDeleted={() => b.load({ silent: true })}
			/>
		</div>
	);
}
