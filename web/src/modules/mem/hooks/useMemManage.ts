// ── 记忆管理模块的核心业务逻辑 ──
//
// 职责分离：
// - useMemManageParams: 只管 URL 查询参数（q/state/sort/page/tag）
// - useMemManage（本文件）: 管理详情状态 + 数据加载 + 业务操作
//
// detailId 用独立信号管理，不走 URL 响应式链路，避免点击列表项时触发列表重新加载。

import { showConfirm, tryAsync, tryOrNotify } from "@lib/utils";
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
} from "@modules/mem";
import { createEffect, createSignal, onMount } from "solid-js";
import type { PageMeta } from "../lib/mem-manage-utils.ts";
import { fetchAllMems } from "../lib/mem-manage-utils.ts";
import { useBatchOps } from "./useBatchOps.ts";
import { useMemEdit } from "./useMemEdit.ts";
import { useMemManageParams } from "./useMemManageParams.ts";
import { useTagFiltersUrl } from "./useTagFiltersUrl.ts";

let initialLoadDone = false;
// 直达模式同步 URL 页码后，跳过随之触发的一次重复加载
let skipNextLoad = false;

// ── 从 URL 读取初始 detailId（只读一次） ──
function readInitialDetailId(): number | null {
	const raw = new URL(window.location.href).searchParams.get("id");
	if (!raw) return null;
	const n = Number(raw);
	return Number.isNaN(n) || n < 1 ? null : n;
}

export function useMemManage() {
	const params = useMemManageParams();
	const { tagFilters, setTagFilters } = useTagFiltersUrl(params);

	// ── detailId：独立信号，不参与 URL 响应式链路 ──
	const [detailId, _setDetailId] = createSignal<number | null>(
		readInitialDetailId(),
	);

	const setDetailId = (id: number | null) => {
		_setDetailId(id);
		// 同步到 URL（replaceState，不触发 SolidJS 响应式）
		const url = new URL(window.location.href);
		if (id != null && id > 0) {
			url.searchParams.set("id", String(id));
		} else {
			url.searchParams.delete("id");
		}
		history.replaceState(null, "", url.toString());
	};

	// ── 核心状态 ──
	const [mems, setMems] = createSignal<MemItem[]>([]);
	const [pageMeta, setPageMeta] = createSignal<PageMeta>({
		page: 1,
		total_pages: 0,
		total: 0,
	});
	const [loading, setLoading] = createSignal(true);
	const [memTags, setMemTags] = createSignal<Map<number, TagInfo[]>>(new Map());
	const [batchIds, setBatchIds] = createSignal<Set<number>>(new Set());
	const [showExportModal, setShowExportModal] = createSignal(false);
	const [showBatchTagModal, setShowBatchTagModal] = createSignal(false);
	const [batchTagMode] = createSignal<"add" | "remove">("add");

	// ── derived ──
	const allSelected = () =>
		mems().length > 0 && batchIds().size === mems().length;
	const detail = () => mems().find((m) => m.id === detailId());
	const tagsForDetail = () => {
		const id = detailId();
		return id !== null ? (memTags().get(id) ?? []) : [];
	};

	// ── 数据加载（只根据查询参数加载，不传 detailId） ──
	const load = async () => {
		setLoading(true);
		const { items, meta } = await fetchAllMems(
			params.sortField(),
			params.sortDir(),
			params.searchQuery(),
			params.filterState(),
			tagFilters(),
			params.tagMode(),
			params.page(),
		);
		setMems(items);
		setPageMeta(meta);
		if (items.length > 0) {
			(async () => {
				const result = await tryAsync(() =>
					batchGetMemsTagsE(items.map((m) => m.id)),
				);
				if (!result.ok) return;
				const res = result.value;
				const map = new Map<number, TagInfo[]>();
				for (const row of res.items) {
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
		} else {
			setMemTags(new Map());
		}
		setLoading(false);
	};

	const silentLoad = async () => {
		const { items, meta } = await fetchAllMems(
			params.sortField(),
			params.sortDir(),
			params.searchQuery(),
			params.filterState(),
			tagFilters(),
			params.tagMode(),
			params.page(),
		);
		setMems(items);
		setPageMeta(meta);
	};

	// ── 初始化：如果有 detailId（URL 直达），加载对应页 ──
	onMount(async () => {
		const initId = detailId();
		if (initId != null) {
			// 直达模式：传递 id 给 API，后端自动定位页码
			setLoading(true);
			const { items, meta } = await fetchAllMems(
				params.sortField(),
				params.sortDir(),
				params.searchQuery(),
				params.filterState(),
				tagFilters(),
				params.tagMode(),
				1,
				initId,
			);
			setMems(items);
			setPageMeta(meta);
			if (items.length > 0) {
				const result = await tryAsync(() =>
					batchGetMemsTagsE(items.map((m) => m.id)),
				);
				if (result.ok) {
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
				}
			}
			setLoading(false);
			// 同步 URL page 参数为实际页码（router 内部状态一致，分页按钮才正确）
			// 同步会触发一次 createEffect → 用 skipNextLoad 跳过重复加载
			if (meta.page > 1 && params.page() !== meta.page) {
				skipNextLoad = true;
				params.setSearchParams({
					page: String(meta.page),
					id: String(initId),
				});
			}
		} else {
			await load();
		}
		initialLoadDone = true;
	});

	// ── 查询参数变化时重新加载（不监听 detailId） ──
	createEffect(() => {
		void params.searchQuery();
		void params.filterState();
		void params.sortField();
		void params.sortDir();
		void params.page();
		void tagFilters();
		void params.tagMode();
		if (!initialLoadDone) return;
		// 直达模式同步 URL 后跳过这次重复加载（数据已就绪）
		if (skipNextLoad) {
			skipNextLoad = false;
			return;
		}
		load();
	});

	// ── detailId 变化时加载详情标签 ──
	createEffect(() => {
		const id = detailId();
		if (id === null) return;
		(async () => {
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

		if (detailId() === id) setDetailId(null);
		setBatchIds((prev) => {
			const n = new Set(prev);
			n.delete(id);
			return n;
		});
		if (mems().length <= 1 && params.page() > 1)
			params.setSearchParams({ page: String(params.page() - 1) });
		else silentLoad();
	};

	const handleReset = async (id: number) => {
		const confirmed = await showConfirm({
			title: "重置记忆",
			message: "确定重置这条记忆的复习进度？所有复习数据将被清除。",
			variant: "warning",
		});
		if (!confirmed) return;

		await tryOrNotify(() => resetMemE(id), "重置");
		load();
	};

	const addTag = async (tag: TagInfo) => {
		const id = detailId();
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
		const id = detailId();
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
		detailId,
		mems,
		reload: load,
	});

	// ── 批量操作 ──
	const batchOps = useBatchOps({
		selectedIds: () => [...batchIds()],
		clearSelection: () => setBatchIds(new Set<number>()),
		reload: load,
		closeDetail: () => setDetailId(null),
		closeTagModal: () => setShowBatchTagModal(false),
	});

	return {
		// 查询参数（来自 params hook）
		searchQuery: params.searchQuery,
		filterState: params.filterState,
		sortField: params.sortField,
		sortDir: params.sortDir,
		page: params.page,
		tagMode: params.tagMode,

		// 详情状态（独立管理）
		detailId,
		setDetailId,

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
		showExportModal,
		setShowExportModal,
		showBatchTagModal,
		setShowBatchTagModal,
		batchTagMode,

		// derived
		allSelected,
		detail,
		tagsForDetail,

		// 搜索/排序/翻页
		handleSearchInput: params.handleSearchInput,
		setFilter: params.setFilter,
		toggleSort: params.toggleSort,
		goToPage: (p: number) => {
			_setDetailId(null);
			// 一次调用同时设置 page 并删除 id，避免 id 残留
			params.setSearchParams({ page: String(p), id: undefined });
		},

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
