// ── /bookmark 数据逻辑：URL query 驱动（q/tag/page）+ 增删改导入 ──

import {
	notifyError,
	notifySuccess,
	numParam,
	showConfirm,
	strParam,
	tryAsync,
	useUrlParams,
} from "@lib/utils";
import type { Bookmark } from "@modules/bookmark";
import {
	createBookmarkE,
	deleteBookmarkE,
	getBookmarksE,
	importBookmarksE,
	searchBookmarksE,
	setBookmarkTagsE,
	updateBookmarkE,
} from "@modules/bookmark";
import { createEffect, createSignal } from "solid-js";

export function useBookmarkPage() {
	// ── 状态全部由 URL query 驱动：q / tag / page ──
	const params = useUrlParams({
		q: strParam(""),
		tag: strParam(""),
		page: numParam(1, { min: 1 }),
	});
	const searchQuery = () => params.get("q");
	const tagFilter = () => params.get("tag");
	const page = () => params.get("page");
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

	async function load(paramsOpt?: { silent?: boolean }) {
		const seq = ++loadSeq;
		const q = searchQuery().trim();
		const tag = tagFilter();
		const pageNum = page();
		if (!paramsOpt?.silent) setLoading(true);
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
		params.set({ q: q.trim(), page: 1 });
	}

	function handleTagFilter(tag: string) {
		params.set({ tag, page: 1 });
	}

	function clearTagFilter() {
		handleTagFilter("");
	}

	function goPage(n: number) {
		if (n < 1 || n > totalPages()) return;
		params.set({ page: n });
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
				setBookmarks((prev) => [
					updated,
					...prev.filter((b) => b.id !== updated.id),
				]);
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
				params.set({ page: back });
			}
		} else {
			// 失败：回滚本地状态
			notifyError("删除失败", result.error);
			setBookmarks(prev);
			setTotal((t) => t + 1);
		}
	}

	return {
		params,
		searchQuery,
		tagFilter,
		page,
		bookmarks,
		total,
		totalPages,
		loading,
		error,
		modalOpen,
		setModalOpen,
		editing,
		formTitle,
		setFormTitle,
		formUrl,
		setFormUrl,
		formDesc,
		setFormDesc,
		formTags,
		saving,
		formError,
		importing,
		tagManagerOpen,
		setTagManagerOpen,
		load,
		handleSearch,
		handleTagFilter,
		clearTagFilter,
		goPage,
		openCreate,
		openEdit,
		addFormTag,
		removeFormTag,
		handleSave,
		handleImportFile,
		handleDelete,
	};
}
