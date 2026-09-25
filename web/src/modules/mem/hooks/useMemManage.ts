// ── 记忆管理模块的核心业务逻辑 ──
//
// 架构原则：
// 1. URL 是唯一权威状态源（useMemManageParams 统一读写，无 replaceState 旁路）
// 2. 列表用 createResource 声明式加载：查询参数 memo 作 source，参数变化自动重取
//    - source 不含 id：点详情不会触发列表重载
//    - refetch 时保留旧值：无闪烁
// 3. 直达（?id=xxx）首次加载传 id 定位页码，同步 URL 后转入正常分页加载
// 4. 无模块级可变状态（initialLoadDone / skipNextLoad 已消灭）
// 5. load 单一职责：列表 / 标签 / 直达各自独立

import { showConfirm, tryAsync, tryOrNotify, useModal } from "@shared/utils";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
} from "solid-js";
import {
	addTagToMemE,
	batchGetMemsTagsE,
	deleteMemE,
	getMemTagsE,
	type MemItem,
	removeTagFromMemE,
	resetMemE,
	suspendMemE,
	type TagInfo,
	unsuspendMemE,
} from "../api.ts";
import type {
	PageMeta,
	SortDir,
	SortField,
	TagMode,
} from "../lib/mem-manage-utils.ts";
import { fetchAllMems } from "../lib/mem-manage-utils.ts";
import { useBatchOps } from "./useBatchOps.ts";
import { useMemEdit } from "./useMemEdit.ts";
import { useMemManageParams } from "./useMemManageParams.ts";
import { useTagFiltersUrl } from "./useTagFiltersUrl.ts";

/** 列表查询参数快照类型（不含 id） */
interface ListKey {
	q: string;
	state: string;
	sort: SortField;
	order: SortDir;
	page: number;
	tagMode: TagMode;
	tagFilters: TagInfo[];
}

// ── 初始 URL 的直达 id（组件挂载时读一次，仅用于直达定位） ──
function readInitialDetailId(): number | null {
	const raw = new URL(window.location.href).searchParams.get("id");
	if (!raw) return null;
	const n = Number(raw);
	return Number.isNaN(n) || n < 1 ? null : n;
}

export function useMemManage() {
	const params = useMemManageParams();
	const { tagFilters, setTagFilters } = useTagFiltersUrl(params);

	// ── 核心状态 ──
	const [memTags, setMemTags] = createSignal<Map<number, TagInfo[]>>(new Map());
	const [batchIds, setBatchIds] = createSignal<Set<number>>(new Set());
	const exportModal = useModal();
	const batchTagModal = useModal();
	const [batchTagMode, setBatchTagMode] = createSignal<"add" | "remove">("add");

	// ── 直达标记：初始 URL 有 id 时，首次请求传 id 定位页码 ──
	const [directId, setDirectId] = createSignal<number | null>(
		readInitialDetailId(),
	);

	// ── 列表查询参数快照（不含 id —— 点详情不重载列表） ──
	const listQuery = createMemo(
		(): ListKey => ({
			q: params.searchQuery(),
			state: params.filterState(),
			sort: params.sortField(),
			order: params.sortDir(),
			page: params.page(),
			tagMode: params.tagMode(),
			tagFilters: tagFilters(),
		}),
	);

	// ── 列表资源：参数变化自动重取；refetch 时保留旧值（无闪烁） ──
	const [list, { refetch }] = createResource<
		{
			items: MemItem[];
			meta: PageMeta;
		},
		ListKey
	>(
		() => listQuery(),
		async (key) => {
			const direct = directId();
			if (direct != null) {
				// 直达定位：page 固定 1，传 id；后端返回实际页数据 + meta.page
				const res = await fetchAllMems(
					key.sort as SortField,
					key.order,
					key.q,
					key.state,
					key.tagFilters,
					key.tagMode,
					1,
					direct,
				);
				// 定位完成：清除直达标记；若实际页 ≠ URL 页，同步 URL（触发静默 refetch，数据一致）
				setDirectId(null);
				if (res.meta.page !== key.page) {
					params.setSearchParams({ page: String(res.meta.page) });
				}
				// 恢复滚动位置
				params.restoreScrollPosition();
				return res;
			}
			const res = await fetchAllMems(
				key.sort as SortField,
				key.order,
				key.q,
				key.state,
				key.tagFilters,
				key.tagMode,
				key.page,
			);
			// 恢复滚动位置
			params.restoreScrollPosition();
			return res;
		},
	);

	// ── 派生 ──
	const mems = (): MemItem[] => list()?.items ?? [];
	const pageMeta = (): PageMeta =>
		list()?.meta ?? { page: 1, total_pages: 0, total: 0 };
	/** 仅首次无数据时显示 loading（refetch 保留旧值不闪） */
	const loading = () => list.loading && !list();
	const allSelected = () =>
		mems().length > 0 && batchIds().size === mems().length;
	const detail = () => mems().find((m) => m.id === params.detailId());
	const tagsForDetail = () => {
		const id = params.detailId();
		return id !== null ? (memTags().get(id) ?? []) : [];
	};

	// ── 列表标签批量填充 ──
	createEffect(() => {
		const items = mems();
		if (items.length === 0) {
			setMemTags(new Map());
			return;
		}
		void (async () => {
			const result = await tryAsync(() =>
				batchGetMemsTagsE(items.map((m) => m.id)),
			);
			if (!result.ok) return;
			const map = new Map<number, TagInfo[]>();
			for (const row of result.value.items) {
				const tags = map.get(row.mem_id) ?? [];
				tags.push({
					id: row.id,
					name: row.name,
					created_at: row.created_at,
				});
				map.set(row.mem_id, tags);
			}
			setMemTags(map);
		})();
	});

	// ── 详情标签补充 ──
	createEffect(() => {
		const id = params.detailId();
		if (id === null) return;
		void (async () => {
			const result = await tryAsync(() => getMemTagsE(id));
			if (!result.ok) return;
			setMemTags((prev) => {
				const next = new Map(prev);
				next.set(id, result.value);
				return next;
			});
		})();
	});

	// ── 操作 ──
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

	const addTag = async (tag: TagInfo) => {
		const id = params.detailId();
		if (id === null) return;
		const ok = await tryOrNotify(() => addTagToMemE(id, tag.id), "添加标签");
		if (!ok) return;
		setMemTags((prev) => {
			const n = new Map(prev);
			const t = n.get(id) ?? [];
			n.set(id, [...t, tag]);
			return n;
		});
	};

	const removeTag = async (tagId: number) => {
		const id = params.detailId();
		if (id === null) return;
		const ok = await tryOrNotify(
			() => removeTagFromMemE(id, tagId),
			"移除标签",
		);
		if (!ok) return;
		setMemTags((prev) => {
			const n = new Map(prev);
			const t = (n.get(id) ?? []).filter((t) => t.id !== tagId);
			n.set(id, t);
			return n;
		});
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
