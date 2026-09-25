// ── /bookmark 数据逻辑：URL query 驱动（q/tag/page）+ 增删改导入 ──
// 组合入口：书签列表 + 多选/批量 + 行内操作 + 表单 + 导入。
//
// 拆分动机（迁移手册 T3，原文件 377 行）：多选与批量操作（105 行）、行内三条动作
// （刷新标题/可访问性/删除，78 行）与取数、滚动保持、表单接线挤在一个函数里。
// 现在两块独立成 hook，依赖由这里传入；对外 API 一字未改（8 处调用点不用动）。

import {
	numParam,
	strParam,
	useListResource,
	useUrlParams,
} from "@shared/utils";
import { createSignal } from "solid-js";
import type { Bookmark } from "../api.ts";
import { getBookmarksE, searchBookmarksE } from "../api.ts";
import { useBookmarkRowActions } from "./bookmark-page/useBookmarkRowActions.ts";
import { useBookmarkSelection } from "./bookmark-page/useBookmarkSelection.ts";
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
	const PAGE_SIZE = 500;

	const [tagManagerOpen, setTagManagerOpen] = createSignal(false);

	// 滚动位置保持
	let savedScrollTop = 0;
	let savedScrollLeft = 0;

	function saveScrollPosition() {
		const scrollContainer =
			document.querySelector("[data-scroll-container]") ||
			document.documentElement;
		savedScrollTop = scrollContainer.scrollTop;
		savedScrollLeft = scrollContainer.scrollLeft;
	}

	function restoreScrollPosition() {
		requestAnimationFrame(() => {
			const scrollContainer =
				document.querySelector("[data-scroll-container]") ||
				document.documentElement;
			scrollContainer.scrollTop = savedScrollTop;
			scrollContainer.scrollLeft = savedScrollLeft;
		});
	}

	/**
	 * 列表数据源走 useListResource：原先手写的 bookmarks/total/totalPages/loading 信号、
	 * `loadSeq` 竞态守卫、"参数变化时重取"的 createEffect 全部由它接管。
	 */
	const list = useListResource<{ q: string; tag: string }, Bookmark>({
		key: () => ({ q: searchQuery().trim(), tag: tagFilter() }),
		page,
		fetcher: (k, p) =>
			k.q
				? searchBookmarksE(k.q, p, PAGE_SIZE, k.tag || undefined)
				: getBookmarksE(p, PAGE_SIZE, k.tag || undefined),
		onLoaded: () => {
			restoreScrollPosition();
		},
	});

	const bookmarks = list.items;
	const total = list.total;
	/** 原实现默认 1 页，保持该语义 */
	const totalPages = () => Math.max(list.totalPages(), 1);
	const loading = list.loading;
	/**
	 * 暴露 **Error 对象**而非消息字符串：消费方（AsyncView / ErrorRetry）用
	 * getErrorMessage 取文案，而它不认字符串 —— 传字符串会一律显示"未知错误"。
	 */
	const error = list.error;

	/**
	 * 重新拉取。`silent: true` 时不经 loading 状态 —— 批量操作/标签变更后的静默同步，
	 * 否则 AsyncView 会先闪一下骨架屏。
	 */
	async function load(paramsOpt?: { silent?: boolean }) {
		await list.reload(paramsOpt);
	}
	const reloadSilent = () => {
		void list.reload({ silent: true });
	};

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
		saveScrollPosition();
		params.set({ page: n });
	}

	// ── 子 hook：多选与批量操作 ──
	const selection = useBookmarkSelection({ items: bookmarks, reloadSilent });

	// ── 子 hook：行内操作（刷新标题 / 可访问性 / 删除） ──
	const rowActions = useBookmarkRowActions({
		list,
		page,
		setPage: (p) => params.set({ page: p }),
		reloadSilent,
	});

	// ── 子 hook：表单 CRUD ──
	const form = useBookmarkForm({ onSaved: reloadSilent });

	// ── 子 hook：导入 ──
	const importHook = useBookmarkImport({ onImported: reloadSilent });

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
		handleDelete: rowActions.handleDelete,
		// 多选
		selectedIds: selection.selectedIds,
		toggleSelect: selection.toggleSelect,
		toggleSelectAll: selection.toggleSelectAll,
		isAllSelected: selection.isAllSelected,
		clearSelection: selection.clearSelection,
		handleBatchDelete: selection.handleBatchDelete,
		// 批量 AI 标签
		batchTagging: selection.batchTagging,
		handleBatchAiTag: selection.handleBatchAiTag,
		// 刷新标题 & 检测可访问性
		handleRefreshTitle: rowActions.handleRefreshTitle,
		handleCheckAccessibility: rowActions.handleCheckAccessibility,
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
		// URL 查重
		urlChecking: () => form.form.urlChecking,
		urlExists: () => form.form.urlExists,
		urlExistsBookmark: () => form.form.urlExistsBookmark,
		checkUrl: form.checkUrl,
		// 获取标题
		fetchingTitle: () => form.form.fetchingTitle,
		fetchTitle: form.fetchTitle,
		// 导入（from useBookmarkImport）
		importing: importHook.importing,
		handleImportFile: importHook.handleImportFile,
	};
}
