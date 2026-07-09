import { createEffect, createSignal, onMount, Show } from "solid-js";
import { A } from "@solidjs/router";
import {
	buryMemE,
	editMemE,
	getAllMemsE,
	deleteMemE,
	resetMemE,
	suspendMemE,
	unsuspendMemE,
	batchBuryMemE,
	batchDeleteMemE,
	batchResetMemE,
	getMemTagsE,
	addTagToMemE,
	removeTagFromMemE,
	batchAddTagToMemsE,
	batchRemoveTagFromMemsE,
	batchGetMemsTagsE,
	type MemItem,
	type TagInfo,
} from "../apis/memApi.ts";
import MemManageToolbar from "../components/mem/MemManageToolbar.tsx";
import MemBatchBar from "../components/mem/MemBatchBar.tsx";
import MemTable from "../components/mem/MemTable.tsx";
import MemDetailPanel from "../components/mem/MemDetailPanel.tsx";
import MemExportModal from "../components/mem/MemExportModal.tsx";
import MemBatchTagModal from "../components/mem/MemBatchTagModal.tsx";
import styles from "./MemManage.module.css";

type SortField = "cue.created_at" | "difficulty" | "due_at" | "state";
type SortDir = "asc" | "desc";

interface PageMeta {
	page: number;
	total_pages: number;
	total: number;
}

async function loadAllMems(
	sortField: SortField,
	sortDir: SortDir,
	search: string,
	stateFilter: string,
	page: number,
): Promise<{ items: MemItem[]; meta: PageMeta }> {
	try {
		const res = await getAllMemsE({
			sort: sortField,
			order: sortDir,
			q: search || undefined,
			state: stateFilter !== "all" ? stateFilter : undefined,
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

export default function MemManage() {
	const [mems, setMems] = createSignal<MemItem[]>([]);
	const [pageMeta, setPageMeta] = createSignal<PageMeta>({
		page: 1,
		total_pages: 0,
		total: 0,
	});
	const [loading, setLoading] = createSignal(true);
	const [detailId, setDetailId] = createSignal<number | null>(null);
	const [memTags, setMemTags] = createSignal<Map<number, TagInfo[]>>(new Map());
	const [sortField, setSortField] = createSignal<SortField>("due_at");
	const [sortDir, setSortDir] = createSignal<SortDir>("asc");
	const [batchIds, setBatchIds] = createSignal<Set<number>>(new Set());
	const [editing, setEditing] = createSignal(false);
	const [editCue, setEditCue] = createSignal("");
	const [editTarget, setEditTarget] = createSignal("");
	const [searchQuery, setSearchQuery] = createSignal("");
	const [filterState, setFilterState] = createSignal<string>("all");
	const [page, setPage] = createSignal(1);
	const [showExportModal, setShowExportModal] = createSignal(false);
	const [showBatchTagModal, setShowBatchTagModal] = createSignal(false);
	const [batchTagMode, setBatchTagMode] = createSignal<"add" | "remove">("add");

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
			page(),
		);
		setMems(items);
		setPageMeta(meta);
		// 批量加载标签
		if (items.length > 0) {
			const ids = items.map((m) => m.id);
			batchGetMemsTagsE(ids)
				.then((rows) => {
					const map = new Map<number, TagInfo[]>();
					for (const row of rows) {
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

	onMount(load);

	// 当 detailId 变化时加载单个记忆的标签（补全）
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
		setSearchQuery(value);
		setPage(1);
		setBatchIds(new Set<number>());
		// 防抖 300ms
		clearTimeout((window as any).__memSearchTimer);
		(window as any).__memSearchTimer = setTimeout(load, 300);
	};

	const setFilter = (st: string) => {
		setFilterState(st);
		setPage(1);
		setBatchIds(new Set<number>());
		setTimeout(load, 0);
	};

	const toggleSort = (field: SortField) => {
		setSortField((prev) => {
			if (prev === field) {
				setSortDir((d) => (d === "asc" ? "desc" : "asc"));
				return prev;
			}
			setSortDir("asc");
			return field;
		});
		setPage(1);
		setTimeout(load, 0);
	};

	const toggleBatch = (id: number) => {
		setBatchIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const toggleAll = () => {
		if (allSelected()) {
			setBatchIds(new Set<number>());
		} else {
			setBatchIds(new Set<number>(mems().map((m) => m.id)));
		}
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
		load();
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
			/>

			<div class={styles.split}>
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
							setPage(p);
							setTimeout(load, 0);
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
