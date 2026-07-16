// ── 记忆管理模块的核心业务逻辑 ──

import { createEffect, createSignal, onMount } from "solid-js";
import {
	addTagToMemE,
	batchAddTagToMemsE,
	batchBuryMemE,
	batchDeleteMemE,
	batchGetMemsTagsE,
	batchRemoveTagFromMemsE,
	batchResetMemE,
	deleteMemE,
	editMemE,
	getMemTagsE,
	removeTagFromMemE,
	resetMemE,
	searchTagsE,
	suspendMemE,
	unsuspendMemE,
	type MemItem,
	type TagInfo,
} from "../../../apis/memApi.ts";
import { fetchAllMems } from "./mem-manage-utils.ts";
import type { PageMeta } from "./mem-manage-utils.ts";
import { useMemManageParams } from "./useMemManageParams.ts";
import type { TagMode } from "../ui/MemManageToolbar.tsx";

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
			try {
				const tags = await searchTagsE(name);
				const found = tags.find((t: TagInfo) => t.name === name);
				if (found) all.push(found);
			} catch {
				/* ignore */
			}
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
			batchGetMemsTagsE(items.map((m) => m.id))
				.then(
					(res: {
						items: {
							mem_id: number;
							id: number;
							name: string;
							created_at: string;
						}[];
					}) => {
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
					},
				)
				.catch(() => {});
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
		getMemTagsE(id)
			.then((tags: TagInfo[]) => {
				setMemTags((prev) => {
					const next = new Map(prev);
					next.set(id, tags);
					return next;
				});
			})
			.catch(() => {});
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
		if (!confirm("确定删除？")) return;
		try {
			await deleteMemE(id);
		} catch {
			/* ignore */
		}
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
		if (!confirm("确定重置？")) return;
		try {
			await resetMemE(id);
		} catch {
			/* ignore */
		}
		load();
	};

	const addTag = async (tag: TagInfo) => {
		const id = params.detailId();
		if (id === null) return;
		await addTagToMemE(id, tag.id);
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
		await removeTagFromMemE(id, tagId);
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
		try {
			await editMemE(d.id, editCue(), editTarget());
		} catch {
			/* ignore */
		}
		setEditing(false);
		load();
	};

	// ── 批量操作 ──
	const batchDelete = async () => {
		const ids = [...batchIds()];
		if (ids.length === 0) return;
		if (!confirm(`确定删除 ${ids.length} 条记忆？`)) return;
		try {
			await batchDeleteMemE(ids);
		} catch {
			/* ignore */
		}
		setBatchIds(new Set<number>());
		params.setDetailId(null);
		load();
	};

	const batchReset = async () => {
		const ids = [...batchIds()];
		if (ids.length === 0) return;
		if (!confirm(`确定重置 ${ids.length} 条记忆？`)) return;
		try {
			await batchResetMemE(ids);
		} catch {
			/* ignore */
		}
		setBatchIds(new Set<number>());
		load();
	};

	const batchBury = async () => {
		const ids = [...batchIds()];
		if (ids.length === 0) return;
		if (!confirm(`确定埋葬 ${ids.length} 条记忆？`)) return;
		try {
			await batchBuryMemE(ids);
		} catch {
			/* ignore */
		}
		setBatchIds(new Set<number>());
		load();
	};

	const handleBatchAddTag = async (tag: TagInfo) => {
		const ids = [...batchIds()];
		if (ids.length === 0) return;
		await batchAddTagToMemsE(ids, tag.id);
		setShowBatchTagModal(false);
		load();
	};

	const handleBatchRemoveTag = async (tag: TagInfo) => {
		const ids = [...batchIds()];
		if (ids.length === 0) return;
		await batchRemoveTagFromMemsE(ids, tag.id);
		setShowBatchTagModal(false);
		load();
	};

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
		batchDelete,
		batchReset,
		batchBury,
		handleBatchAddTag,
		handleBatchRemoveTag,
	};
}
