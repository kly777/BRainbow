// ── 记忆管理模块的核心业务逻辑（组合入口） ──
//
// 架构原则（原样保留）：
// 1. URL 是唯一权威状态源（useMemManageParams 统一读写，无 replaceState 旁路）
// 2. 列表声明式加载：查询参数 memo 作 source，参数变化自动重取（见 mem-manage/useMemManageList.ts）
// 3. 直达（?id=xxx）首次加载传 id 定位页码，同步 URL 后转入正常分页加载
// 4. 无模块级可变状态（initialLoadDone / skipNextLoad 已消灭）
// 5. load 单一职责：列表 / 标签 / 直达各自独立
//
// 拆分动机（迁移手册 T3，原文件 355 行）：列表取数与标签映射各成一块后，
// 这里只剩选择、删除/重置、弹层与接线。对外 API 一字未改。

import { showConfirm, tryOrNotify, useModal } from "@shared/utils";
import { createSignal } from "solid-js";
import { deleteMemE, resetMemE, suspendMemE, unsuspendMemE } from "../api.ts";
import { useMemManageList } from "./mem-manage/useMemManageList.ts";
import { useMemTags } from "./mem-manage/useMemTags.ts";
import { useBatchOps } from "./useBatchOps.ts";
import { useMemEdit } from "./useMemEdit.ts";
import { useMemManageParams } from "./useMemManageParams.ts";
import { useTagFiltersUrl } from "./useTagFiltersUrl.ts";

export function useMemManage() {
	const params = useMemManageParams();
	const { tagFilters, setTagFilters } = useTagFiltersUrl(params);

	// ── 核心状态 ──
	const [batchIds, setBatchIds] = createSignal<Set<number>>(new Set());
	const exportModal = useModal();
	const batchTagModal = useModal();
	const [batchTagMode, setBatchTagMode] = createSignal<"add" | "remove">("add");

	// ── 子 hook：列表取数 ──
	const { refetch, mems, pageMeta, loading } = useMemManageList({
		params,
		tagFilters,
	});

	// ── 子 hook：标签映射（可见页批量填充 + 详情补充 + 增删） ──
	const { memTags, tagsForDetail, addTag, removeTag } = useMemTags({
		mems,
		detailId: params.detailId,
	});

	// ── 派生 ──
	const allSelected = () =>
		mems().length > 0 && batchIds().size === mems().length;
	const detail = () => mems().find((m) => m.id === params.detailId());

	// ── 选择 ──
	const toggleBatch = (id: number) =>
		setBatchIds((prev) => {
			const n = new Set(prev);
			if (n.has(id)) n.delete(id);
			else n.add(id);
			return n;
		});

	const toggleAll = () =>
		allSelected()
			? setBatchIds(new Set<number>())
			: setBatchIds(new Set(mems().map((m) => m.id)));

	// ── 操作 ──
	const handleDelete = async (id: number) => {
		const confirmed = await showConfirm({
			title: "删除记忆",
			message: "确定删除这条记忆？此操作不可撤销。",
			variant: "danger",
		});
		if (!confirmed) return;

		const ok = await tryOrNotify(() => deleteMemE(id), "删除");
		if (!ok) return;

		if (params.detailId() === id) params.setDetailId(null);
		setBatchIds((prev) => {
			const n = new Set(prev);
			n.delete(id);
			return n;
		});
		// 当前页删空且不在第一页 → 回退一页；否则静默刷新
		if (mems().length <= 1 && params.page() > 1)
			params.goToPage(params.page() - 1);
		else void refetch();
	};

	const handleReset = async (id: number) => {
		const confirmed = await showConfirm({
			title: "重置记忆",
			message: "确定重置这条记忆的复习进度？所有复习数据将被清除。",
			variant: "warning",
		});
		if (!confirmed) return;

		await tryOrNotify(() => resetMemE(id), "重置");
		void refetch();
	};

	// ── 编辑弹层 ──
	const editHook = useMemEdit({
		detailId: params.detailId,
		mems,
		reload: () => refetch(),
	});

	// ── 批量操作 ──
	const batchOps = useBatchOps({
		selectedIds: () => [...batchIds()],
		clearSelection: () => setBatchIds(new Set<number>()),
		reload: () => refetch(),
		closeDetail: () => params.setDetailId(null),
		closeTagModal: () => batchTagModal.close(),
	});

	return {
		// 查询参数（来自 params hook，URL 唯一权威）
		searchQuery: params.searchQuery,
		filterState: params.filterState,
		sortField: params.sortField,
		sortDir: params.sortDir,
		page: params.page,
		tagMode: params.tagMode,

		// 详情状态（URL ?id=）
		detailId: params.detailId,
		setDetailId: params.setDetailId,

		// 标签过滤
		tagFilters,
		setTagFilters,

		// 核心状态
		mems,
		pageMeta,
		loading,
		memTags,
		batchIds,
		editing: editHook.editing,
		setEditing: editHook.setEditing,
		editCue: editHook.editCue,
		setEditCue: editHook.setEditCue,
		editTarget: editHook.editTarget,
		setEditTarget: editHook.setEditTarget,
		showExportModal: exportModal.isOpen,
		setShowExportModal: (v: boolean) =>
			v ? exportModal.open() : exportModal.close(),
		showBatchTagModal: batchTagModal.isOpen,
		setShowBatchTagModal: (v: boolean) =>
			v ? batchTagModal.open() : batchTagModal.close(),
		batchTagMode,
		setBatchTagMode,

		// derived
		allSelected,
		detail,
		tagsForDetail,

		// 搜索/排序/翻页（换页时 params 内清除 id）
		handleSearchInput: params.handleSearchInput,
		setFilter: params.setFilter,
		toggleSort: params.toggleSort,
		goToPage: params.goToPage,

		// 操作
		toggleBatch,
		toggleAll,
		handleDelete,
		handleReset,
		addTag,
		removeTag,
		startEdit: editHook.startEdit,
		saveEdit: editHook.saveEdit,
		suspendMemE,
		unsuspendMemE,

		// 批量操作
		batchDelete: batchOps.batchDelete,
		batchReset: batchOps.batchReset,
		batchBury: batchOps.batchBury,
		handleBatchAddTag: batchOps.batchAddTag,
		handleBatchRemoveTag: batchOps.batchRemoveTag,
	};
}
