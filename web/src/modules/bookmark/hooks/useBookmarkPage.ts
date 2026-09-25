// ── /bookmark 数据逻辑：URL query 驱动（q/tag/page）+ 增删改导入 ──
// 组合入口：书签列表 + 表单 + 导入。

import {
	notifyError,
	notifySuccess,
	numParam,
	showConfirm,
	strParam,
	tryAsync,
	useListResource,
	useUrlParams,
} from "@shared/utils";
import { createSignal } from "solid-js";
import type { Bookmark } from "../api.ts";
import {
	batchDeleteBookmarksE,
	deleteBookmarkE,
	fetchUrlTitleE,
	getBookmarksE,
	searchBookmarksE,
	setBookmarkTagsE,
	suggestBookmarkTagsE,
	updateBookmarkE,
} from "../api.ts";
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

	// 多选状态
	const [selectedIds, setSelectedIds] = createSignal<Set<number>>(new Set());

	/**
	 * 列表数据源：改用 useListResource（createResource 范式）。
	 * 原先手写的 bookmarks/total/totalPages/loading 信号、`loadSeq` 竞态守卫、
	 * 以及"参数变化时重取"的 createEffect 全部由它接管 —— createResource
	 * 自带竞态处理，不必手写守卫。
	 *
	 * 导出名保持不变（bookmarks/total/totalPages/loading/error/load），
	 * 故 8 处调用点无需改动。
	 */
	const list = useListResource<{ q: string; tag: string }, Bookmark>({
		key: () => ({ q: searchQuery().trim(), tag: tagFilter() }),
		page,
		fetcher: (k, p) =>
			k.q
				? searchBookmarksE(k.q, p, PAGE_SIZE, k.tag || undefined)
				: getBookmarksE(p, PAGE_SIZE, k.tag || undefined),
		onLoaded: () => {
			// 恢复滚动位置
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
	 * getErrorMessage 取文案，而它不认字符串 —— 传字符串会一律显示"未知错误"，
	 * 真实错误信息丢失（此前本页就是这样）。
	 */
	const error = list.error;

	/**
	 * 重新拉取。`silent: true` 时不经 loading 状态 —— 批量操作/标签变更后的
	 * 静默同步，否则 AsyncView 会先闪一下骨架屏。
	 */
	async function load(paramsOpt?: { silent?: boolean }) {
		await list.reload(paramsOpt);
	}

	function handleSearch(q: string) {
		params.set({ q: q.trim(), page: 1 });
	}

	function handleTagFilter(tag: string) {
		params.set({ tag, page: 1 });
	}

	function clearTagFilter() {
		handleTagFilter("");
	}

	// 滚动位置保持
	let savedScrollTop = 0;
	let savedScrollLeft = 0;

	// 保存滚动位置
	function saveScrollPosition() {
		const scrollContainer =
			document.querySelector("[data-scroll-container]") ||
			document.documentElement;
		savedScrollTop = scrollContainer.scrollTop;
		savedScrollLeft = scrollContainer.scrollLeft;
	}

	// 恢复滚动位置
	function restoreScrollPosition() {
		requestAnimationFrame(() => {
			const scrollContainer =
				document.querySelector("[data-scroll-container]") ||
				document.documentElement;
			scrollContainer.scrollTop = savedScrollTop;
			scrollContainer.scrollLeft = savedScrollLeft;
		});
	}

	function goPage(n: number) {
		if (n < 1 || n > totalPages()) return;
		// 保存滚动位置
		saveScrollPosition();
		params.set({ page: n });
	}

	// ── 多选操作 ──
	function toggleSelect(id: number) {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}

	function selectAll() {
		const allIds = bookmarks().map((b) => b.id);
		setSelectedIds(new Set(allIds));
	}

	function clearSelection() {
		setSelectedIds(new Set<number>());
	}

	function isAllSelected() {
		const bks = bookmarks();
		return bks.length > 0 && bks.every((b) => selectedIds().has(b.id));
	}

	function toggleSelectAll() {
		if (isAllSelected()) {
			clearSelection();
		} else {
			selectAll();
		}
	}

	async function handleBatchDelete() {
		const ids = Array.from(selectedIds());
		if (ids.length === 0) return;

		const confirmed = await showConfirm({
			title: "批量删除书签",
			message: `确定要删除选中的 ${ids.length} 个书签吗？此操作不可撤销。`,
			variant: "danger",
		});
		if (!confirmed) return;

		const result = await tryAsync(() => batchDeleteBookmarksE(ids));
		if (result.ok) {
			notifySuccess(`已删除 ${ids.length} 个书签`);
			clearSelection();
			load({ silent: true });
		} else {
			notifyError("批量删除失败", result.error);
		}
	}

	// ── 批量 AI 标签 ──
	const [batchTagging, setBatchTagging] = createSignal(false);

	async function handleBatchAiTag() {
		const ids = Array.from(selectedIds());
		if (ids.length === 0) return;

		setBatchTagging(true);
		let successCount = 0;
		let failCount = 0;
		let totalTagsAdded = 0;

		// 构建 id→bookmark 映射
		const bmMap = new Map(bookmarks().map((b) => [b.id, b]));

		for (const id of ids) {
			const bm = bmMap.get(id);
			if (!bm) continue;

			try {
				const suggestResult = await suggestBookmarkTagsE(id);
				const existing = new Set(bm.tags);
				const newTags = suggestResult.tags.filter((t) => !existing.has(t));
				if (newTags.length === 0) continue;

				const merged = [...bm.tags, ...newTags];
				await setBookmarkTagsE(id, merged);
				successCount++;
				totalTagsAdded += newTags.length;
			} catch {
				failCount++;
			}
		}

		setBatchTagging(false);
		clearSelection();

		if (successCount > 0) {
			notifySuccess(
				`AI 标签完成：${successCount} 个书签添加了 ${totalTagsAdded} 个标签` +
					(failCount > 0 ? `，${failCount} 个失败` : ""),
			);
			load({ silent: true });
		} else if (failCount > 0) {
			notifyError(`AI 标签失败：${failCount} 个书签`);
		} else {
			notifySuccess("AI 建议的标签都已存在，无需添加");
		}
	}

	// ── 刷新标题 ──
	async function handleRefreshTitle(bm: Bookmark) {
		const result = await tryAsync(() => fetchUrlTitleE(bm.url));
		if (!result.ok) {
			notifyError("获取标题失败", result.error);
			return;
		}
		if (!result.value.title) {
			notifyError("获取标题失败", new Error("未能获取标题"));
			return;
		}
		const updateResult = await tryAsync(() =>
			updateBookmarkE(bm.id, { title: result.value.title }),
		);
		if (updateResult.ok) {
			notifySuccess("标题已刷新");
			load({ silent: true });
		} else {
			notifyError("更新标题失败", updateResult.error);
		}
	}

	// ── 检测可访问性 ──
	async function handleCheckAccessibility(
		bm: Bookmark,
	): Promise<"ok" | "fail"> {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 10000);
			const resp = await fetch(bm.url, {
				method: "HEAD",
				mode: "no-cors",
				signal: controller.signal,
			});
			clearTimeout(timeout);
			// no-cors 模式下 status 为 0，但不报错说明可达
			notifySuccess("该网址可访问");
			return "ok";
		} catch {
			notifyError("该网址无法访问");
			return "fail";
		}
	}

	// ── 子 hook：表单 CRUD ──
	const form = useBookmarkForm({
		onSaved: () => load({ silent: true }),
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

		const wasLastOnPage = bookmarks().length === 1 && page() > 1;

		// 乐观移除：失败由 useListResource 回滚整份快照（items 与 total 一并还原）
		const result = await list.optimistic(
			(items) => items.filter((b) => b.id !== bm.id),
			() => deleteBookmarkE(bm.id),
			{ total: Math.max(0, list.total() - 1) },
		);
		if (result.ok) {
			notifySuccess("书签已删除");
			if (wasLastOnPage) params.set({ page: page() - 1 });
		} else {
			notifyError("删除失败", result.error);
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
		// 多选
		selectedIds,
		toggleSelect,
		toggleSelectAll,
		isAllSelected,
		clearSelection,
		handleBatchDelete,
		// 批量 AI 标签
		batchTagging,
		handleBatchAiTag,
		// 刷新标题 & 检测可访问性
		handleRefreshTitle,
		handleCheckAccessibility,
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
