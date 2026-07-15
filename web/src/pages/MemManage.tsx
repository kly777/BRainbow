import { A, useSearchParams } from "@solidjs/router";
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
	getAllMemsE,
	getMemTagsE,
	type MemItem,
	removeTagFromMemE,
	resetMemE,
	searchTagsE,
	suspendMemE,
	type TagInfo,
	unsuspendMemE,
} from "../apis/memApi.ts";
import MemBatchBar from "../components/mem/MemBatchBar.tsx";
import MemBatchTagModal from "../components/mem/MemBatchTagModal.tsx";
import MemDetailPanel from "../components/mem/MemDetailPanel.tsx";
import MemExportModal from "../components/mem/MemExportModal.tsx";
import MemManageToolbar, {
	type TagMode,
} from "../components/mem/MemManageToolbar.tsx";
import MemTable from "../components/mem/MemTable.tsx";
import styles from "./MemManage.module.css";

type SortField = "cue.created_at" | "difficulty" | "due_at" | "state";
type SortDir = "asc" | "desc";

interface PageMeta {
	page: number;
	total_pages: number;
	total: number;
}

const VALID_STATES = [
	"all",
	"new",
	"learning",
	"review",
	"relearning",
	"suspended",
	"buried",
	"today_done",
];
const VALID_SORT_FIELDS: SortField[] = [
	"cue.created_at",
	"difficulty",
	"due_at",
	"state",
];

async function loadAllMems(
	sortField: SortField,
	sortDir: SortDir,
	search: string,
	stateFilter: string,
	tagFilters: TagInfo[],
	tagMode: TagMode,
	page: number,
): Promise<{ items: MemItem[]; meta: PageMeta }> {
	try {
		const tagIds = tagFilters.map((t) => t.id).join(",");
		const res = await getAllMemsE({
			sort: sortField,
			order: sortDir,
			q: search || undefined,
			state: stateFilter !== "all" ? stateFilter : undefined,
			tag_ids: tagMode === "include" ? tagIds || undefined : undefined,
			exclude_tag_ids: tagMode === "exclude" ? tagIds || undefined : undefined,
			page,
			page_size: 50,
		});
		return {
			items: res.items,
			meta: { page: res.page, total_pages: res.total_pages, total: res.total },
		};
	} catch {
		return { items: [], meta: { page: 1, total_pages: 0, total: 0 } };
	}
}

let _searchTimer: ReturnType<typeof setTimeout> | undefined;

let initialLoadDone = false;

export default function MemManage() {
	const [searchParams, setSearchParams] = useSearchParams();

	// ── URL 派生状态 ──
	const searchQuery = () => {
		const q = searchParams.q;
		return typeof q === "string" ? q : "";
	};
	const filterState = () => {
		const s = searchParams.state;
		return typeof s === "string" && VALID_STATES.includes(s) ? s : "all";
	};
	const sortField = () => {
		const s = searchParams.sort;
		return typeof s === "string" && VALID_SORT_FIELDS.includes(s as SortField)
			? (s as SortField)
			: "due_at";
	};
	const sortDir = (): SortDir =>
		searchParams.order === "desc" ? "desc" : "asc";
	const page = () => {
		const p = Number(searchParams.page);
		return p > 0 ? p : 1;
	};
	const detailId = () => {
		const id = Number(searchParams.id);
		return id > 0 ? id : null;
	};
	const setDetailId = (id: number | null) =>
		setSearchParams({ id: id != null ? String(id) : undefined });

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

	// ── URL 持久化的标签过滤 ──
	const _tagFilterIds = () => {
		const v = searchParams.tag_ids;
		return typeof v === "string"
			? v.split(",").filter(Boolean).map(Number)
			: [];
	};
	const tagMode = (): TagMode =>
		searchParams.tag_mode === "exclude" ? "exclude" : "include";
	// 用名字在 URL 中持久化，避免 ID 漂移
	const tagFilterNames = () => {
		const v = searchParams.tag_names;
		return typeof v === "string" ? v.split(",").filter(Boolean) : [];
	};
	const [tagFilters, setTagFiltersInternal] = createSignal<TagInfo[]>([]);
	// 从 URL 名字解析为 TagInfo 对象
	// 从 URL 中的 tag_names 恢复 TagInfo 对象
	onMount(async () => {
		const names = tagFilterNames();
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
		const names = tags.map((t) => t.name).join(",");
		setSearchParams({
			tag_names: names || undefined,
			tag_mode: mode === "exclude" ? "exclude" : undefined,
		});
	};

	// ── Derived ──
	const allSelected = () =>
		mems().length > 0 && batchIds().size === mems().length;

	const detail = () => mems().find((m) => m.id === detailId());

	const tagsForDetail = () => {
		const id = detailId();
		return id !== null ? (memTags().get(id) ?? []) : [];
	};

	// ── Actions ──

	const load = async () => {
		setLoading(true);
		const { items, meta } = await loadAllMems(
			sortField(),
			sortDir(),
			searchQuery(),
			filterState(),
			tagFilters(),
			tagMode(),
			page(),
		);
		setMems(items);
		setPageMeta(meta);
		if (items.length > 0) {
			const ids = items.map((m) => m.id);
			batchGetMemsTagsE(ids)
				.then((res) => {
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
				})
				.catch(() => {});
		} else {
			setMemTags(new Map());
		}
		setLoading(false);
	};

	onMount(() => {
		load();
		initialLoadDone = true;
	});

	// URL 参数变化时重新加载（含浏览器前进/后退）
	createEffect(() => {
		// 读取 URL 派生值来追踪依赖
		void searchQuery();
		void filterState();
		void sortField();
		void sortDir();
		void page();
		void tagFilters();
		void tagMode();
		if (!initialLoadDone) return;
		load();
	});

	// 当 detailId 变化时加载单个记忆的标签
	createEffect(() => {
		const id = detailId();
		if (id === null) return;
		getMemTagsE(id)
			.then((tags) => {
				setMemTags((prev) => {
					const next = new Map(prev);
					next.set(id, tags);
					return next;
				});
			})
			.catch(() => {});
	});

	const handleSearchInput = (value: string) => {
		setSearchParams({ q: value || undefined, page: "1" });
		setBatchIds(new Set<number>());
	};

	const setFilter = (st: string) => {
		setSearchParams({ state: st === "all" ? undefined : st, page: "1" });
		setBatchIds(new Set<number>());
	};

	const toggleSort = (field: SortField) => {
		const curField = sortField();
		const curDir = sortDir();
		const params: Record<string, string | undefined> = { page: "1" };
		if (curField === field) {
			params.order = curDir === "asc" ? "desc" : "asc";
		} else {
			params.sort = field;
			params.order = "asc";
		}
		setSearchParams(params);
	};

	const toggleBatch = (id: number) => {
		setBatchIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const toggleAll = () => {
		if (allSelected()) setBatchIds(new Set<number>());
		else setBatchIds(new Set<number>(mems().map((m) => m.id)));
	};

	const silentLoad = async () => {
		const { items, meta } = await loadAllMems(
			sortField(),
			sortDir(),
			searchQuery(),
			filterState(),
			tagFilters(),
			tagMode(),
			page(),
		);
		setMems(items);
		setPageMeta(meta);
	};

	const handleDelete = async (id: number) => {
		if (!confirm("确定删除？")) return;
		try {
			await deleteMemE(id);
		} catch {
			/* ignore */
		}
		if (detailId() === id) setDetailId(null);
		setBatchIds((prev) => {
			const next = new Set(prev);
			next.delete(id);
			return next;
		});
		// 当前页只剩这条且不是第一页 → 回退
		if (mems().length <= 1 && page() > 1) {
			setSearchParams({ page: String(page() - 1) });
		} else {
			// 静默刷新，不显示 loading
			silentLoad();
		}
	};

	const handleReset = async (id: number) => {
		if (!confirm("确定重置？将清空所有记忆数据")) return;
		try {
			await resetMemE(id);
		} catch {
			/* ignore */
		}
		load();
	};

	const addTag = async (tag: TagInfo) => {
		const id = detailId();
		if (id === null) return;
		await addTagToMemE(id, tag.id);
		setMemTags((prev) => {
			const next = new Map(prev);
			const t = next.get(id) ?? [];
			next.set(id, [...t, tag]);
			return next;
		});
	};

	const removeTag = async (tagId: number) => {
		const id = detailId();
		if (id === null) return;
		await removeTagFromMemE(id, tagId);
		setMemTags((prev) => {
			const next = new Map(prev);
			const t = (next.get(id) ?? []).filter((t) => t.id !== tagId);
			next.set(id, t);
			return next;
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
		setDetailId(null);
		load();
	};

	const batchReset = async () => {
		const ids = [...batchIds()];
		if (ids.length === 0) return;
		if (!confirm(`确定重置 ${ids.length} 条记忆的记忆数据？`)) return;
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
		if (!confirm(`确定埋葬 ${ids.length} 条记忆？（移至池底）`)) return;
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

	return (
		<div class={styles.page}>
			<div class={styles.topBar}>
				<A href="/m" class={styles.backLink}>
					← 记忆
				</A>
				<h1 class={styles.title}>记忆管理</h1>
				<div class={styles.topActions}>
					<A href="/m/add" class={styles.addLink}>
						＋ 添加
					</A>
					<span class={styles.count}>{pageMeta().total} 个</span>
				</div>
			</div>

			<MemManageToolbar
				searchQuery={searchQuery()}
				filterState={filterState()}
				onSearch={handleSearchInput}
				onFilterChange={setFilter}
				onExport={() => setShowExportModal(true)}
				tagFilters={tagFilters()}
				tagMode={tagMode()}
				onTagFiltersChange={setTagFilters}
			/>

			<div
				class={styles.split}
				classList={{ [styles.detailActive]: detailId() !== null }}
			>
				<div class={styles.tableWrap}>
					<MemBatchBar
						selectedCount={batchIds().size}
						onReset={batchReset}
						onBury={batchBury}
						onTag={() => {
							setBatchTagMode("add");
							setShowBatchTagModal(true);
						}}
						onTagRemove={() => {
							setBatchTagMode("remove");
							setShowBatchTagModal(true);
						}}
						onDelete={batchDelete}
					/>
					<MemTable
						mems={mems()}
						batchIds={batchIds()}
						sortField={sortField()}
						sortDir={sortDir()}
						detailId={detailId()}
						memTags={memTags()}
						allSelected={allSelected()}
						loading={loading()}
						pageMeta={pageMeta()}
						page={page()}
						onToggleSort={toggleSort}
						onToggleBatch={toggleBatch}
						onToggleAll={toggleAll}
						onSelectRow={setDetailId}
						onDelete={handleDelete}
						onPageChange={(p) => {
							setSearchParams({ page: String(p) });
						}}
					/>
				</div>
				<MemDetailPanel
					mem={detail()}
					memTags={tagsForDetail()}
					editing={editing()}
					editCue={editCue()}
					editTarget={editTarget()}
					onEditCueChange={setEditCue}
					onEditTargetChange={setEditTarget}
					onStartEdit={startEdit}
					onSaveEdit={saveEdit}
					onCancelEdit={() => setEditing(false)}
					onReset={handleReset}
					onSuspend={async (id) => {
						await suspendMemE(id);
						load();
					}}
					onUnsuspend={async (id) => {
						await unsuspendMemE(id);
						load();
					}}
					onDelete={handleDelete}
					onAddTag={addTag}
					onRemoveTag={removeTag}
				/>
			</div>

			<MemExportModal
				isOpen={showExportModal()}
				onClose={() => setShowExportModal(false)}
			/>
			<MemBatchTagModal
				isOpen={showBatchTagModal()}
				onClose={() => setShowBatchTagModal(false)}
				mode={batchTagMode()}
				selectedCount={batchIds().size}
				onAddTag={handleBatchAddTag}
				onRemoveTag={handleBatchRemoveTag}
			/>
		</div>
	);
}
