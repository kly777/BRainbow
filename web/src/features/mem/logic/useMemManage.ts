// ── 记忆管理模块的核心业务逻辑 ──

import { createEffect, createSignal, onMount } from "solid-js";
import { notifyError } from "../../../lib/notify.ts";
import { tryAsync } from "../../../lib/result.ts";
import { showConfirm, tryOrNotify } from "../../../lib/safe-action.ts";
import {
	addTagToMemE,
	batchGetMemsTagsE,
	deleteMemE,
	editMemE,
	getMemTagsE,
	type MemItem,
	removeTagFromMemE,
	resetMemE,
	searchTagsE,
	suspendMemE,
	type TagInfo,
	unsuspendMemE,
} from "../api.ts";
import type { TagMode } from "../ui/MemManageToolbar.tsx";
import type { PageMeta } from "./mem-manage-utils.ts";
import { fetchAllMems } from "./mem-manage-utils.ts";
import { useBatchOps } from "./useBatchOps.ts";
import { useMemManageParams } from "./useMemManageParams.ts";

let initialLoadDone = false;

export function useMemManage() {
	const params = useMemManageParams();

	// ── 标签过滤 URL 持久化 ──
	const [tagFilters, setTagFiltersInternal] = createSignal<TagInfo[]>([]);

	onMount(async () => {
		const names = params.tagFilterNames();
		if (names.length === 0) return;
		const all: TagInfo[] = [];
		for (const name of names) {
			const result = await tryAsync(() => searchTagsE(name));
			if (result.ok) {
				const found = result.value.find((t: TagInfo) => t.name === name);
				if (found) all.push(found);
			}
			// URL 中的标签名可能已失效，忽略即可
		}
		setTagFiltersInternal(all);
	});

	const setTagFilters = (tags: TagInfo[], mode: TagMode) => {
		setTagFiltersInternal(tags);
		params.setSearchParams({
			tag_names: tags.map((t) => t.name).join(",") || undefined,
			tag_mode: mode === "exclude" ? "exclude" : undefined,
		});
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
	const [editing, setEditing] = createSignal(false);
	const [editCue, setEditCue] = createSignal("");
	const [editTarget, setEditTarget] = createSignal("");
	const [showExportModal, setShowExportModal] = createSignal(false);
	const [showBatchTagModal, setShowBatchTagModal] = createSignal(false);
	const [batchTagMode, setBatchTagMode] = createSignal<"add" | "remove">("add");

	// ── derived ──
	const allSelected = () =>
		mems().length > 0 && batchIds().size === mems().length;
	const detail = () => mems().find((m) => m.id === params.detailId());
	const tagsForDetail = () => {
		const id = params.detailId();
		return id !== null ? (memTags().get(id) ?? []) : [];
	};

	// ── 数据加载 ──
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
				if (!result.ok) return; // 标签加载失败不影响主列表
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

	onMount(() => {
		load();
		initialLoadDone = true;
	});

	createEffect(() => {
		void params.searchQuery();
		void params.filterState();
		void params.sortField();
		void params.sortDir();
		void params.page();
		void tagFilters();
		void params.tagMode();
		if (!initialLoadDone) return;
		load();
	});

	createEffect(() => {
		const id = params.detailId();
		if (id === null) return;
		(async () => {
			const result = await tryAsync(() => getMemTagsE(id));
			if (!result.ok) return; // 标签加载失败不影响详情展示
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

	const startEdit = () => {
		const d = detail();
		if (!d) return;
		setEditCue(d.cue.content);
		setEditTarget(d.target.content);
		setEditing(true);
	};

	const saveEdit = async () => {
		const d = detail();
		if (!d) return;
		const ok = await tryOrNotify(
			() => editMemE(d.id, editCue(), editTarget()),
			"保存编辑",
		);
		if (!ok) return;
		setEditing(false);
		load();
	};

	// ── 批量操作 ──
	const batchOps = useBatchOps({
		selectedIds: () => [...batchIds()],
		clearSelection: () => setBatchIds(new Set<number>()),
		reload: load,
		closeDetail: () => params.setDetailId(null),
		closeTagModal: () => setShowBatchTagModal(false),
	});

	return {
		// URL 参数（来自 params hook）
		searchQuery: params.searchQuery,
		filterState: params.filterState,
		sortField: params.sortField,
		sortDir: params.sortDir,
		page: params.page,
		detailId: params.detailId,
		setDetailId: params.setDetailId,
		tagMode: params.tagMode,

		// 标签过滤
		tagFilters,
		setTagFilters,

		// 核心状态
		mems,
		pageMeta,
		loading,
		memTags,
		batchIds,
		editing,
		setEditing,
		editCue,
		setEditCue,
		editTarget,
		setEditTarget,
		showExportModal,
		setShowExportModal,
		showBatchTagModal,
		setShowBatchTagModal,
		batchTagMode,

		// derived
		allSelected,
		detail,
		tagsForDetail,

		// 搜索/排序
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
		startEdit,
		saveEdit,
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
