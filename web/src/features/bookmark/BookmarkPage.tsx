import { createEffect, createSignal, For, Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import Button from "@components/ui/Button.tsx";
import Modal from "@components/ui/Modal.tsx";
import SearchInput from "@components/ui/SearchInput.tsx";
import { tryAsync } from "@lib/result.ts";
import { notifyError, notifySuccess } from "@lib/notify.ts";
import { showConfirm } from "@lib/safe-action.ts";
import TagInput from "@features/bookmark/TagInput.tsx";
import Favicon from "@features/bookmark/Favicon.tsx";
import TagManager from "@features/bookmark/TagManager.tsx";
import {
	createBookmarkE,
	deleteBookmarkE,
	getBookmarksE,
	importBookmarksE,
	searchBookmarksE,
	setBookmarkTagsE,
	updateBookmarkE,
} from "@features/bookmark/api.ts";
import type { Bookmark } from "@features/bookmark/types.ts";
import styles from "@features/bookmark/BookmarkPage.module.css";

/** 从 URL 提取域名（用于展示与标题兜底） */
function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

/** 从 URL 参数读取正整数页码，非法则回退 1 */
function parsePage(v: string | undefined): number {
	const n = Number(v);
	return Number.isInteger(n) && n > 0 ? n : 1;
}

export default function BookmarkPage() {
	// ── 状态全部由 URL query 驱动：q / tag / page ──
	const [searchParams, setSearchParams] = useSearchParams();
	const searchQuery = () => (typeof searchParams.q === "string" ? searchParams.q : "");
	const tagFilter = () => (typeof searchParams.tag === "string" ? searchParams.tag : "");
	const page = () => parsePage(
		typeof searchParams.page === "string" ? searchParams.page : undefined,
	);
	const [pageSize] = createSignal(500);

	const [bookmarks, setBookmarks] = createSignal<Bookmark[]>([]);
	const [total, setTotal] = createSignal(0);
	const [totalPages, setTotalPages] = createSignal(1);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);

	const [modalOpen, setModalOpen] = createSignal(false);
	const [editing, setEditing] = createSignal<Bookmark | null>(null);
	const [formTitle, setFormTitle] = createSignal("");
	const [formUrl, setFormUrl] = createSignal("");
	const [formDesc, setFormDesc] = createSignal("");
	const [formTags, setFormTags] = createSignal<string[]>([]);
	const [saving, setSaving] = createSignal(false);
	const [formError, setFormError] = createSignal<string | null>(null);

	const [importing, setImporting] = createSignal(false);
	const [tagManagerOpen, setTagManagerOpen] = createSignal(false);

	// 竞态守卫：只应用最新一次请求的结果
	let loadSeq = 0;

	async function load(params?: { silent?: boolean }) {
		const seq = ++loadSeq;
		const q = searchQuery().trim();
		const tag = tagFilter();
		const pageNum = page();
		if (!params?.silent) setLoading(true);
		setError(null);
		const result = await tryAsync(() =>
			q
				? searchBookmarksE(q, pageNum, pageSize(), tag || undefined)
				: getBookmarksE(pageNum, pageSize(), tag || undefined),
		);
		if (seq !== loadSeq) return;
		if (result.ok) {
			setBookmarks(result.value.items);
			setTotal(result.value.total);
			setTotalPages(result.value.total_pages);
		} else {
			setError(result.error.message);
		}
		setLoading(false);
	}

	// URL 参数变化（搜索/过滤/翻页/后退前进）时自动加载
	createEffect(() => {
		void searchQuery();
		void tagFilter();
		void page();
		void load();
	});

	function handleSearch(q: string) {
		setSearchParams({ q: q.trim() || undefined, page: undefined });
	}

	function handleTagFilter(tag: string) {
		setSearchParams({ tag: tag || undefined, page: undefined });
	}

	function clearTagFilter() {
		handleTagFilter("");
	}

	function goPage(n: number) {
		if (n < 1 || n > totalPages()) return;
		setSearchParams({ page: n > 1 ? String(n) : undefined });
	}

	function openCreate() {
		setEditing(null);
		setFormTitle("");
		setFormUrl("");
		setFormDesc("");
		setFormTags([]);
		setFormError(null);
		setModalOpen(true);
	}

	function openEdit(bm: Bookmark) {
		setEditing(bm);
		setFormTitle(bm.title);
		setFormUrl(bm.url);
		setFormDesc(bm.description);
		setFormTags([...bm.tags]);
		setFormError(null);
		setModalOpen(true);
	}

	function addFormTag(name: string) {
		if (!name.trim()) return;
		setFormTags((prev) => {
			if (prev.includes(name.trim())) return prev;
			return [...prev, name.trim()];
		});
	}

	function removeFormTag(name: string) {
		setFormTags((prev) => prev.filter((t) => t !== name));
	}

	async function handleSave() {
		const title = formTitle().trim();
		const url = formUrl().trim();
		if (!title) {
			setFormError("标题不能为空");
			return;
		}
		if (!/^https?:\/\//i.test(url)) {
			setFormError("URL 必须以 http:// 或 https:// 开头");
			return;
		}

		setSaving(true);
		setFormError(null);
		const tags = formTags();
		const body = { title, url, description: formDesc().trim() };
		const result = await tryAsync(async () => {
			if (editing()) {
				const updated = await updateBookmarkE(editing()!.id, body);
				await setBookmarkTagsE(updated.id, tags);
				return { ...updated, tags };
			}
			return createBookmarkE({ ...body, tags });
		});
		if (result.ok) {
			setModalOpen(false);
			notifySuccess(editing() ? "书签已更新" : "书签已添加");
			const updated = result.value;
			if (searchQuery() || tagFilter()) {
				// 有过滤条件时新数据可能不匹配，静默刷新
				load({ silent: true });
			} else if (editing()) {
				// 编辑：本地更新该项，保持位置
				setBookmarks((prev) =>
					prev.map((b) => (b.id === updated.id ? updated : b)),
				);
			} else {
				// 创建：新书签按创建时间倒序排在最前
				setBookmarks((prev) => [updated, ...prev.filter((b) => b.id !== updated.id)]);
				setTotal((t) => t + 1);
			}
		} else {
			setFormError(result.error.message);
		}
		setSaving(false);
	}

	async function handleImportFile(file: File | undefined) {
		if (!file) return;
		setImporting(true);
		const result = await tryAsync(() => importBookmarksE(file));
		if (result.ok) {
			notifySuccess(
				"导入完成",
				`新建 ${result.value.created} 条，合并标签 ${result.value.merged} 条`,
			);
			load({ silent: true });
		} else {
			notifyError("导入失败", result.error);
		}
		setImporting(false);
	}

	// ── 删除：乐观更新，失败回滚 ──
	async function handleDelete(bm: Bookmark) {
		const confirmed = await showConfirm({
			title: "删除书签",
			message: `确定要删除「${bm.title}」吗？此操作不可撤销。`,
			variant: "danger",
		});
		if (!confirmed) return;

		const prev = bookmarks();
		const wasLastOnPage = prev.length === 1 && page() > 1;

		// 乐观移除
		setBookmarks(prev.filter((b) => b.id !== bm.id));
		setTotal((t) => Math.max(0, t - 1));

		const result = await tryAsync(() => deleteBookmarkE(bm.id));
		if (result.ok) {
			notifySuccess("书签已删除");
			// 当前页被删空时回退一页（URL 变化触发加载）
			if (wasLastOnPage) {
				const back = page() - 1;
				setSearchParams({ page: back > 1 ? String(back) : undefined });
			}
		} else {
			// 失败：回滚本地状态
			notifyError("删除失败", result.error);
			setBookmarks(prev);
			setTotal((t) => t + 1);
		}
	}

	return (
		<div class={styles.page}>
			<div class={styles.header}>
				<h1>网页书签</h1>
				<SearchInput
					value={searchQuery()}
					onSearch={handleSearch}
					placeholder="搜索标题 / URL / 备注…"
				/>
				<Show when={searchQuery().trim()}>
					<Button
						variant="icon"
						title="清空搜索"
						onClick={() => handleSearch("")}
					>
						✕
					</Button>
				</Show>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => document.getElementById("bookmark-import-input")?.click()}
					disabled={importing()}
				>
					{importing() ? "导入中..." : "导入 Firefox 书签"}
				</Button>
				<input
					id="bookmark-import-input"
					type="file"
					accept=".html,.htm,text/html"
					style={{ display: "none" }}
					onChange={(e) => {
						handleImportFile(e.currentTarget.files?.[0]);
						e.currentTarget.value = "";
					}}
				/>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => setTagManagerOpen(true)}
				>
					标签管理
				</Button>
				<Button variant="primary" size="sm" onClick={openCreate}>
					＋ 新建书签
				</Button>
			</div>

			<Show when={tagFilter()}>
				<div class={styles.filterBar}>
					<span class={styles.filterLabel}>标签：{tagFilter()}</span>
					<Button variant="ghost" size="sm" onClick={clearTagFilter}>
						清除过滤 ×
					</Button>
				</div>
			</Show>

			<Show when={loading()}>
				<div class={styles.state}>加载中...</div>
			</Show>
			<Show when={error()}>
				<div class={styles.state}>
					<p class={styles.errorText}>加载失败：{error()}</p>
					<Button variant="secondary" size="sm" onClick={() => load()}>
						重试
					</Button>
				</div>
			</Show>

			<Show when={!loading() && !error()}>
				<Show
					when={bookmarks().length > 0}
					fallback={
						<div class={styles.state}>
							{searchQuery().trim() || tagFilter()
								? "没有找到匹配的书签"
								: "还没有书签，点击上方按钮添加第一个吧！"}
						</div>
					}
				>
					<div class={styles.list}>
						<For each={bookmarks()}>
							{(bm) => (
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
														handleTagFilter(tag);
													}}
												>
													#{tag}
												</button>
											)}
										</For>
									</div>
									<div class={styles.itemActions}>
										<Button
											variant="icon"
											title="编辑"
											onClick={() => openEdit(bm)}
										>
											✎
										</Button>
										<Button
											variant="icon"
											title="删除"
											onClick={() => handleDelete(bm)}
										>
											✕
										</Button>
									</div>
								</div>
							)}
						</For>
					</div>

					<Show when={totalPages() > 1}>
						<div class={styles.pagination}>
							<span>
								第 {page()} / {totalPages()} 页（共 {total()} 条）
							</span>
							<div class={styles.paginationActions}>
								<Button
									variant="secondary"
									size="sm"
									disabled={page() <= 1}
									onClick={() => goPage(page() - 1)}
								>
									← 上一页
								</Button>
								<Button
									variant="secondary"
									size="sm"
									disabled={page() >= totalPages()}
									onClick={() => goPage(page() + 1)}
								>
									下一页 →
								</Button>
							</div>
						</div>
					</Show>
				</Show>
			</Show>

			<Modal
				isOpen={modalOpen()}
				onClose={() => setModalOpen(false)}
				title={editing() ? "编辑书签" : "新建书签"}
				actions={
					<>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setModalOpen(false)}
							disabled={saving()}
						>
							取消
						</Button>
						<Button
							variant="primary"
							size="sm"
							onClick={handleSave}
							disabled={saving()}
						>
							{saving() ? "保存中..." : "保存"}
						</Button>
					</>
				}
			>
				<Show when={formError()}>
					<div class={styles.formError}>{formError()}</div>
				</Show>
				<div class={styles.formGroup}>
					<label class={styles.formLabel} for="bookmark-title">
						标题
					</label>
					<input
						id="bookmark-title"
						class={styles.formInput}
						value={formTitle()}
						onInput={(e) => setFormTitle(e.currentTarget.value)}
						placeholder="书签名称"
						disabled={saving()}
					/>
				</div>
				<div class={styles.formGroup}>
					<label class={styles.formLabel} for="bookmark-url">
						URL
					</label>
					<input
						id="bookmark-url"
						class={styles.formInput}
						value={formUrl()}
						onInput={(e) => setFormUrl(e.currentTarget.value)}
						placeholder="https://example.com"
						disabled={saving()}
					/>
				</div>
				<div class={styles.formGroup}>
					<label class={styles.formLabel} for="bookmark-desc">
						备注
					</label>
					<textarea
						id="bookmark-desc"
						class={styles.formTextarea}
						value={formDesc()}
						onInput={(e) => setFormDesc(e.currentTarget.value)}
						placeholder="可选，一句话描述这个网页（可选）"
						rows={3}
						disabled={saving()}
					/>
				</div>
				<div class={styles.formGroup}>
					<span class={styles.formLabel}>标签</span>
					<TagInput
						tags={formTags()}
						onAdd={addFormTag}
						onRemove={removeFormTag}
						onTagDeleted={() => load({ silent: true })}
					/>
				</div>
			</Modal>

			<TagManager
				isOpen={tagManagerOpen()}
				onClose={() => setTagManagerOpen(false)}
				onDeleted={() => load({ silent: true })}
			/>
		</div>
	);
}
