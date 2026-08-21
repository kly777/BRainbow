// ── /bookmark 数据逻辑：URL query 驱动（q/tag/page）+ 增删改导入 ──
// 组合入口：书签列表 + 表单 + 导入。

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
	deleteBookmarkE,
	getBookmarksE,
	searchBookmarksE,
} from "@modules/bookmark";
import { createEffect, createSignal } from "solid-js";
import { useBookmarkForm } from "./useBookmarkForm.ts";
import { useBookmarkImport } from "./useBookmarkImport.ts";

export function useBookmarkPage() {
	// ── URL query 驱动 ──
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
	const [tagManagerOpen, setTagManagerOpen] = createSignal(false);

	// 竞态守卫
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

	// URL 参数变化时自动加载
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

	// ── 子 hook：表单 CRUD ──
	const form = useBookmarkForm({
		onSaved: () => {
			if (searchQuery() || tagFilter()) {
				load({ silent: true });
			} else {
				load({ silent: true });
			}
		},
	});

	// ── 子 hook：导入 ──
	const importHook = useBookmarkImport({
		onImported: () => load({ silent: true }),
	});

	// ── 删除 ──
	async function handleDelete(bm: Bookmark) {
		const confirmed = await showConfirm({
			title: "删除书签",
			message: `确定要删除「${bm.title}」吗？此操作不可撤销。`,
			variant: "danger",
		});
		if (!confirmed) return;

		const prev = bookmarks();
		const wasLastOnPage = prev.length === 1 && page() > 1;

		setBookmarks(prev.filter((b) => b.id !== bm.id));
		setTotal((t) => Math.max(0, t - 1));

		const result = await tryAsync(() => deleteBookmarkE(bm.id));
		if (result.ok) {
			notifySuccess("书签已删除");
			if (wasLastOnPage) {
				const back = page() - 1;
				params.set({ page: back });
			}
		} else {
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
		tagManagerOpen,
		setTagManagerOpen,
		load,
		handleSearch,
		handleTagFilter,
		clearTagFilter,
		goPage,
		handleDelete,
		// 表单（from useBookmarkForm）
		modalOpen: () => form.form.open,
		setModalOpen: (v: boolean) => form.setForm("open", v),
		editing: () => form.form.editing,
		formTitle: () => form.form.title,
		setFormTitle: (v: string) => form.setForm("title", v),
		formUrl: () => form.form.url,
		setFormUrl: (v: string) => form.setForm("url", v),
		formDesc: () => form.form.desc,
		setFormDesc: (v: string) => form.setForm("desc", v),
		formTags: () => form.form.tags,
		saving: () => form.form.saving,
		formError: () => form.form.error,
		openCreate: form.openCreate,
		openEdit: form.openEdit,
		addFormTag: form.addTag,
		removeFormTag: form.removeTag,
		handleSave: form.handleSave,
		// 导入（from useBookmarkImport）
		importing: importHook.importing,
		handleImportFile: importHook.handleImportFile,
	};
}
