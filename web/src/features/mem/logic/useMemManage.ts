// ── 记忆管理模块的核心业务逻辑 ──

import { useSearchParams } from "@solidjs/router";
import { createEffect, createSignal, onMount } from "solid-js";
import {
	addTagToMemE, batchAddTagToMemsE, batchBuryMemE, batchDeleteMemE,
	batchGetMemsTagsE, batchRemoveTagFromMemsE, batchResetMemE,
	deleteMemE, editMemE, getAllMemsE, getMemTagsE,
	removeTagFromMemE, resetMemE, searchTagsE, suspendMemE, unsuspendMemE,
	type MemItem, type TagInfo,
} from "../../../apis/memApi.ts";
import type { TagMode } from "../ui/MemManageToolbar.tsx";

// ── 类型 ──

type SortField = "cue.created_at" | "difficulty" | "due_at" | "state";
type SortDir = "asc" | "desc";

interface PageMeta { page: number; total_pages: number; total: number; }

const VALID_STATES = ["all", "new", "learning", "review", "relearning", "suspended", "buried", "today_done"];
const VALID_SORT_FIELDS: SortField[] = ["cue.created_at", "difficulty", "due_at", "state"];

let initialLoadDone = false;

async function fetchAllMems(
	sortField: SortField, sortDir: SortDir, search: string, stateFilter: string,
	tagFilters: TagInfo[], tagMode: TagMode, page: number,
): Promise<{ items: MemItem[]; meta: PageMeta }> {
	try {
		const tagIds = tagFilters.map((t) => t.id).join(",");
		const res = await getAllMemsE({
			sort: sortField, order: sortDir,
			q: search || undefined,
			state: stateFilter !== "all" ? stateFilter : undefined,
			tag_ids: tagMode === "include" ? tagIds || undefined : undefined,
			exclude_tag_ids: tagMode === "exclude" ? tagIds || undefined : undefined,
			page, page_size: 50,
		});
		return { items: res.items, meta: { page: res.page, total_pages: res.total_pages, total: res.total } };
	} catch {
		return { items: [], meta: { page: 1, total_pages: 0, total: 0 } };
	}
}

// ── Hook ──

export function useMemManage() {
	const [searchParams, setSearchParams] = useSearchParams();

	// ── URL 派生 ──
	const searchQuery = () => { const q = searchParams.q; return typeof q === "string" ? q : ""; };
	const filterState = () => { const s = searchParams.state; return typeof s === "string" && VALID_STATES.includes(s) ? s : "all"; };
	const sortField = (): SortField => { const s = searchParams.sort; return typeof s === "string" && VALID_SORT_FIELDS.includes(s as SortField) ? (s as SortField) : "due_at"; };
	const sortDir = (): SortDir => searchParams.order === "desc" ? "desc" : "asc";
	const page = () => { const p = Number(searchParams.page); return p > 0 ? p : 1; };
	const detailId = () => { const id = Number(searchParams.id); return id > 0 ? id : null; };
	const setDetailId = (id: number | null) => setSearchParams({ id: id != null ? String(id) : undefined });

	// ── 标签过滤 URL 持久化 ──
	const tagMode = (): TagMode => searchParams.tag_mode === "exclude" ? "exclude" : "include";
	const tagFilterNames = () => { const v = searchParams.tag_names; return typeof v === "string" ? v.split(",").filter(Boolean) : []; };
	const [tagFilters, setTagFiltersInternal] = createSignal<TagInfo[]>([]);

	onMount(async () => {
		const names = tagFilterNames();
		if (names.length === 0) return;
		const all: TagInfo[] = [];
		for (const name of names) {
			try {
				const tags = await searchTagsE(name);
				const found = tags.find((t: TagInfo) => t.name === name);
				if (found) all.push(found);
			} catch { /* ignore */ }
		}
		setTagFiltersInternal(all);
	});

	const setTagFilters = (tags: TagInfo[], mode: TagMode) => {
		setTagFiltersInternal(tags);
		setSearchParams({ tag_names: tags.map((t) => t.name).join(",") || undefined, tag_mode: mode === "exclude" ? "exclude" : undefined });
	};

	// ── 核心状态 ──
	const [mems, setMems] = createSignal<MemItem[]>([]);
	const [pageMeta, setPageMeta] = createSignal<PageMeta>({ page: 1, total_pages: 0, total: 0 });
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
	const allSelected = () => mems().length > 0 && batchIds().size === mems().length;
	const detail = () => mems().find((m) => m.id === detailId());
	const tagsForDetail = () => { const id = detailId(); return id !== null ? (memTags().get(id) ?? []) : []; };

	// ── 数据加载 ──
	const load = async () => {
		setLoading(true);
		const { items, meta } = await fetchAllMems(sortField(), sortDir(), searchQuery(), filterState(), tagFilters(), tagMode(), page());
		setMems(items); setPageMeta(meta);
		if (items.length > 0) {
			batchGetMemsTagsE(items.map((m) => m.id)).then((res: { items: { mem_id: number; id: number; name: string; created_at: string }[] }) => {
				const map = new Map<number, TagInfo[]>();
				for (const row of res.items) {
					const tags = map.get(row.mem_id) ?? [];
					tags.push({ id: row.id, name: row.name, created_at: row.created_at });
					map.set(row.mem_id, tags);
				}
				setMemTags(map);
			}).catch(() => {});
		} else { setMemTags(new Map()); }
		setLoading(false);
	};

	const silentLoad = async () => {
		const { items, meta } = await fetchAllMems(sortField(), sortDir(), searchQuery(), filterState(), tagFilters(), tagMode(), page());
		setMems(items); setPageMeta(meta);
	};

	onMount(() => { load(); initialLoadDone = true; });

	createEffect(() => {
		void searchQuery(); void filterState(); void sortField(); void sortDir();
		void page(); void tagFilters(); void tagMode();
		if (!initialLoadDone) return;
		load();
	});

	createEffect(() => {
		const id = detailId();
		if (id === null) return;
		getMemTagsE(id).then((tags: TagInfo[]) => {
			setMemTags((prev) => { const next = new Map(prev); next.set(id, tags); return next; });
		}).catch(() => {});
	});

	// ── 操作 ──
	const handleSearchInput = (value: string) => {
		setSearchParams({ q: value || undefined, page: "1" });
		setBatchIds(new Set<number>());
	};

	const setFilter = (st: string) => {
		setSearchParams({ state: st === "all" ? undefined : st, page: "1" });
		setBatchIds(new Set<number>());
	};

	const toggleSort = (field: SortField) => {
		const params: Record<string, string | undefined> = { page: "1" };
		if (sortField() === field) params.order = sortDir() === "asc" ? "desc" : "asc";
		else { params.sort = field; params.order = "asc"; }
		setSearchParams(params);
	};

	const toggleBatch = (id: number) => setBatchIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
	const toggleAll = () => allSelected() ? setBatchIds(new Set<number>()) : setBatchIds(new Set(mems().map((m) => m.id)));

	const handleDelete = async (id: number) => {
		if (!confirm("确定删除？")) return;
		try { await deleteMemE(id); } catch { /* ignore */ }
		if (detailId() === id) setDetailId(null);
		setBatchIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
		if (mems().length <= 1 && page() > 1) setSearchParams({ page: String(page() - 1) });
		else silentLoad();
	};

	const handleReset = async (id: number) => {
		if (!confirm("确定重置？")) return;
		try { await resetMemE(id); } catch { /* ignore */ }
		load();
	};

	const addTag = async (tag: TagInfo) => {
		const id = detailId(); if (id === null) return;
		await addTagToMemE(id, tag.id);
		setMemTags((prev) => { const n = new Map(prev); const t = n.get(id) ?? []; n.set(id, [...t, tag]); return n; });
	};

	const removeTag = async (tagId: number) => {
		const id = detailId(); if (id === null) return;
		await removeTagFromMemE(id, tagId);
		setMemTags((prev) => { const n = new Map(prev); const t = (n.get(id) ?? []).filter((t) => t.id !== tagId); n.set(id, t); return n; });
	};

	const startEdit = () => { const d = detail(); if (!d) return; setEditCue(d.cue.content); setEditTarget(d.target.content); setEditing(true); };

	const saveEdit = async () => {
		const d = detail(); if (!d) return;
		try { await editMemE(d.id, editCue(), editTarget()); } catch { /* ignore */ }
		setEditing(false); load();
	};

	// ── 批量操作 ──
	const batchDelete = async () => {
		const ids = [...batchIds()]; if (ids.length === 0) return;
		if (!confirm(`确定删除 ${ids.length} 条记忆？`)) return;
		try { await batchDeleteMemE(ids); } catch { /* ignore */ }
		setBatchIds(new Set<number>()); setDetailId(null); load();
	};

	const batchReset = async () => {
		const ids = [...batchIds()]; if (ids.length === 0) return;
		if (!confirm(`确定重置 ${ids.length} 条记忆？`)) return;
		try { await batchResetMemE(ids); } catch { /* ignore */ }
		setBatchIds(new Set<number>()); load();
	};

	const batchBury = async () => {
		const ids = [...batchIds()]; if (ids.length === 0) return;
		if (!confirm(`确定埋葬 ${ids.length} 条记忆？`)) return;
		try { await batchBuryMemE(ids); } catch { /* ignore */ }
		setBatchIds(new Set<number>()); load();
	};

	const handleBatchAddTag = async (tag: TagInfo) => {
		const ids = [...batchIds()]; if (ids.length === 0) return;
		await batchAddTagToMemsE(ids, tag.id);
		setShowBatchTagModal(false); load();
	};

	const handleBatchRemoveTag = async (tag: TagInfo) => {
		const ids = [...batchIds()]; if (ids.length === 0) return;
		await batchRemoveTagFromMemsE(ids, tag.id);
		setShowBatchTagModal(false); load();
	};

	return {
		searchQuery, filterState, sortField, sortDir, page, detailId, setDetailId,
		tagMode, tagFilters, setTagFilters,
		mems, pageMeta, loading, memTags, batchIds,
		editing, setEditing, editCue, setEditCue, editTarget, setEditTarget,
		showExportModal, setShowExportModal,
		showBatchTagModal, setShowBatchTagModal, batchTagMode,
		allSelected, detail, tagsForDetail,
		handleSearchInput, setFilter, toggleSort, toggleBatch, toggleAll,
		handleDelete, handleReset, addTag, removeTag, startEdit, saveEdit,
		suspendMemE, unsuspendMemE,
		batchDelete, batchReset, batchBury, handleBatchAddTag, handleBatchRemoveTag,
	};
}
