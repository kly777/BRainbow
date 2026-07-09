import { createEffect, createSignal, onMount, Show, For } from "solid-js";
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
	setMemTagsE,
	batchAddTagToMemsE,
	batchRemoveTagFromMemsE,
	batchSetTagsForMemsE,
	batchGetMemsTagsE,
	type MemItem,
	type TagInfo,
	type MemTagRow,
} from "../apis/memApi.ts";
import MarkdownRenderer from "../components/ui/Markdown.tsx";
import MarkdownEditor from "../components/ui/MarkdownEditor.tsx";
import TagSelector from "../components/TagSelector.tsx";
import Modal from "../components/ui/Modal.tsx";
import { fmtLocal, fmtRelative } from "../lib/time.ts";
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

function previewText(content: string): string {
	return content.slice(0, 50).replace(/\n/g, " ") || "（空）";
}

export default function MemManage() {
	const [mems, setMems] = createSignal<MemItem[]>([]);
	const [pageMeta, setPageMeta] = createSignal<PageMeta>({ page: 1, total_pages: 0, total: 0 });
	const [loading, setLoading] = createSignal(true);
	const [detailId, setDetailId] = createSignal<number | null>(null);
	const [memTags, setMemTags] = createSignal<Map<number, TagInfo[]>>(new Map());
	const [allTagsLoaded, setAllTagsLoaded] = createSignal(false);
	const [sortField, setSortField] = createSignal<SortField>("due_at");
	const [sortDir, setSortDir] = createSignal<SortDir>("asc");
	const [batchIds, setBatchIds] = createSignal<Set<number>>(new Set());
	const [editing, setEditing] = createSignal(false);
	const [editCue, setEditCue] = createSignal("");
	const [editTarget, setEditTarget] = createSignal("");
	const [searchQuery, setSearchQuery] = createSignal("");
	const [filterState, setFilterState] = createSignal<string>("all");

	const allSelected = () =>
		mems().length > 0 && batchIds().size === mems().length;

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

	const setFilter = (st: string) => {
		setFilterState(st);
		setPage(1);
		setBatchIds(new Set<number>());
		setTimeout(load, 0);
	};

	const [page, setPage] = createSignal(1);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	const handleSearchInput = (value: string) => {
		setSearchQuery(value);
		setPage(1);
		setBatchIds(new Set<number>());
		// 防抖 300ms，避免频繁请求
		clearTimeout(searchTimer);
		searchTimer = setTimeout(load, 300);
	};

	// 当 detailId 变化时加载标签
	createEffect(() => {
		const id = detailId();
		if (id === null) return;
		getMemTagsE(id).then((tags) => {
			setMemTags((prev) => {
				const next = new Map(prev);
				next.set(id, tags);
				return next;
			});
		}).catch(() => {});
	});

	const tagsForDetail = () => {
		const id = detailId();
		return id !== null ? (memTags().get(id) ?? []) : [];
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

	// ── 批量标签 ──
	const [showBatchTagModal, setShowBatchTagModal] = createSignal(false);
	const [batchTagMode, setBatchTagMode] = createSignal<"add" | "remove" | "set">("add");

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

	const load = async () => {
		setLoading(true);
		const { items, meta } = await loadAllMems(sortField(), sortDir(), searchQuery(), filterState(), page());
		setMems(items);
		setPageMeta(meta);
		// 批量加载标签
		if (items.length > 0) {
			const ids = items.map((m) => m.id);
			batchGetMemsTagsE(ids).then((rows) => {
				const map = new Map<number, TagInfo[]>();
				for (const row of rows) {
					const tags = map.get(row.mem_id) ?? [];
					tags.push({ id: row.id, name: row.name, created_at: row.created_at });
					map.set(row.mem_id, tags);
				}
				setMemTags(map);
			}).catch(() => {});
		} else {
			setMemTags(new Map());
		}
		setAllTagsLoaded(true);
		setLoading(false);
	};
	onMount(load);

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

	const handleReset = async (id: number) => {
		if (!confirm("确定重置？将清空所有记忆数据")) return;
		try {
			await resetMemE(id);
		} catch {
			/* ignore */
		}
		load();
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

	const detail = () => mems().find((m) => m.id === detailId());

	return (
		<div class={styles.page}>
			<div class={styles.topBar}>
				<A href="/m" class={styles.backLink}>← 记忆</A>
				<h1 class={styles.title}>记忆管理</h1>
				<div class={styles.topActions}>
					<A href="/m/add" class={styles.addLink}>
						＋ 添加
					</A>
					<span class={styles.count}>{pageMeta().total} 个</span>
				</div>
			</div>
			<div class={styles.toolbar}>
				<input
					type="search"
					class={styles.searchInput}
					placeholder="搜索线索或答案…"
					value={searchQuery()}
					onInput={(e) => { handleSearchInput(e.currentTarget.value); }}
				/>
				<div class={styles.filterGroup}>
					{[
						["all", "全部"],
						["new", "新"],
						["learning", "学习"],
						["review", "复习"],
						["relearning", "重学"],
						["suspended", "挂起"],
						["today_done", "已复习"],
					].map(([val, label]) => (
						<button
							type="button"
							class={filterState() === val ? styles.filterActive : styles.filterBtn}
							onClick={() => setFilter(val)}
						>
							{label}
						</button>
					))}
				</div>
			</div>
			<div class={styles.split}>
				<div class={styles.tableWrap}>
					<Show
						when={!loading()}
						fallback={<div class={styles.empty}>加载中…</div>}
					>
						<div class={styles.batchBar} classList={{ [styles.batchBarVisible]: batchIds().size > 0 }}>
							<span class={styles.batchCount}>{batchIds().size} 条已选</span>
							<button
								type="button"
								class={styles.batchBtnReset}
								onClick={batchReset}
							>
								忘却
							</button>
							<button
								type="button"
								class={styles.batchBtnBury}
								onClick={batchBury}
							>
								埋葬
							</button>
							<button
								type="button"
								class={styles.batchBtnTag}
								onClick={() => { setBatchTagMode("add"); setShowBatchTagModal(true); }}
							>
								标签+
							</button>
							<button
								type="button"
								class={styles.batchBtnTagRemove}
								onClick={() => { setBatchTagMode("remove"); setShowBatchTagModal(true); }}
							>
								标签-
							</button>
							<button
								type="button"
								class={styles.batchBtnDelete}
								onClick={batchDelete}
							>
								删除
							</button>
						</div>
						<table class={styles.table}>
							<thead>
								<tr>
									<th class={styles.thCb}>
										<input
											type="checkbox"
											checked={allSelected()}
											onInput={toggleAll}
										/>
									</th>
									<th class={styles.th}>线索</th>
									<th class={styles.th}>答案</th>
									<th class={styles.thSort} onClick={() => toggleSort("state")}>
										状态{sortField() === "state" ? (sortDir() === "asc" ? " ▲" : " ▼") : ""}
									</th>
									<th class={styles.thSort} onClick={() => toggleSort("difficulty")}>
										难度{sortField() === "difficulty" ? (sortDir() === "asc" ? " ▲" : " ▼") : ""}
									</th>
									<th class={styles.thSort} onClick={() => toggleSort("due_at")}>
										复习{sortField() === "due_at" ? (sortDir() === "asc" ? " ▲" : " ▼") : ""}
									</th>
									<th class={styles.thSort} onClick={() => toggleSort("cue.created_at")}>
										创建{sortField() === "cue.created_at" ? (sortDir() === "asc" ? " ▲" : " ▼") : ""}
									</th>
									<th class={styles.th}>标签</th>
									<th class={styles.th} />
								</tr>
							</thead>
							<tbody>
								<For each={mems()}>
									{(mem) => (
										<tr
											class={
												detailId() === mem.id ? styles.rowActive : styles.row
											}
										>
											<td class={styles.tdCb}>
												<input
													type="checkbox"
													checked={batchIds().has(mem.id)}
													onInput={() => toggleBatch(mem.id)}
													onClick={(e) => e.stopPropagation()}
												/>
											</td>
											<td
												class={styles.td}
												onClick={() => setDetailId(mem.id)}
												onKeyDown={(e) => { if (e.key === 'Enter') setDetailId(mem.id); }}
											>
												{previewText(mem.cue.content)}
											</td>
											<td
												class={styles.td}
												onClick={() => setDetailId(mem.id)}
												onKeyDown={(e) => { if (e.key === 'Enter') setDetailId(mem.id); }}
											>
												{previewText(mem.target.content)}
											</td>
											<td class={styles.td}>
												<span
													classList={{
														[styles.badge]: true,
														[styles[mem.state]]: true,
													}}
												>
													{mem.state}
													{mem.leeched && <span class={styles.leechedBadge}> ⚠️</span>}
												</span>
											</td>
											<td class={styles.td}>{mem.difficulty.toFixed(2)}</td>
											<td class={styles.tdDue}>{fmtRelative(mem.due_at)}</td>
											<td class={styles.tdDue}>{fmtLocal(mem.cue.created_at)}</td>
											<td class={styles.td}>
												<div class={styles.cellTags}>
													<For each={(memTags().get(mem.id) ?? []).slice(0, 3)}>
														{(tag) => <span class={styles.cellTag}>{tag.name}</span>}
													</For>
													<Show when={(memTags().get(mem.id) ?? []).length > 3}>
														<span class={styles.cellTag}>+{(memTags().get(mem.id) ?? []).length - 3}</span>
													</Show>
												</div>
											</td>
											<td class={styles.tdAct}>
												<button
													type="button"
													class={styles.delBtn}
													onClick={(e) => {
														e.stopPropagation();
														handleDelete(mem.id);
													}}
												>
													×
												</button>
											</td>
										</tr>
									)}
								</For>
							</tbody>
						</table>
						<Show when={pageMeta().total_pages > 1}>
							<div class={styles.pagination}>
								<button
									type="button"
									class={styles.pageBtn}
									disabled={page() <= 1}
									onClick={() => { setPage((p) => Math.max(1, p - 1)); setTimeout(load, 0); }}
								>
									‹
								</button>
								<span class={styles.pageInfo}>
									{pageMeta().page} / {pageMeta().total_pages}（共{pageMeta().total}条）
								</span>
								<button
									type="button"
									class={styles.pageBtn}
									disabled={page() >= pageMeta().total_pages}
									onClick={() => { setPage((p) => p + 1); setTimeout(load, 0); }}
								>
									›
								</button>
							</div>
						</Show>
					</Show>
				</div>
				<div class={styles.detail}>
					<Show
						when={detail()}
						fallback={<div class={styles.empty}>点击左侧条目查看详情</div>}
					>
						{(d) => (
							<>
								<Show
									when={editing()}
									fallback={
										<>
											<div class={styles.section}>
												<span class={styles.sectionLabel}>线索</span>
												<div class={styles.content}>
													<MarkdownRenderer content={d().cue.content} />
												</div>
											</div>
											<div class={styles.section}>
												<span class={styles.sectionLabel}>答案</span>
												<div class={styles.content}>
													<MarkdownRenderer content={d().target.content} />
												</div>
											</div>
										</>
									}
								>
									<div class={styles.section}>
										<span class={styles.sectionLabel}>线索</span>
										<MarkdownEditor
											class={styles.editArea}
											value={editCue()}
											onInput={setEditCue}
											rows={4}
										/>
									</div>
									<div class={styles.section}>
										<span class={styles.sectionLabel}>答案</span>
										<MarkdownEditor
											class={styles.editArea}
											value={editTarget()}
											onInput={setEditTarget}
											rows={4}
										/>
									</div>
								</Show>
								<div class={styles.meta}>
									<span>状态：{d().state}{d().leeched ? ' ⚠️烂卡' : ''}</span>
									<span>遗忘：{d().lapses} 次</span>
									<span>难度：{d().difficulty.toFixed(2)}</span>
									<span>创建：{fmtLocal(d().cue.created_at)}</span>
									<span>到期：{fmtLocal(d().due_at)}</span>
								</div>
								<div class={styles.section}>
									<span class={styles.sectionLabel}>标签</span>
									<TagSelector
										tags={tagsForDetail()}
										onAdd={addTag}
										onRemove={removeTag}
									/>
								</div>
								<div class={styles.actionBtns}>
									{editing() ? (
										<>
											<button
												type="button"
												class={styles.editBtn}
												onClick={saveEdit}
											>
												保存
											</button>
											<button
												type="button"
												class={styles.cancelBtn}
												onClick={() => setEditing(false)}
											>
												取消
											</button>
										</>
									) : (
										<>
											<button
												type="button"
												class={styles.editBtn}
												onClick={startEdit}
											>
												编辑
											</button>
											<button
												type="button"
												class={styles.cancelBtn}
												onClick={() => handleReset(d().id)}
											>
												忘却
											</button>
											<Show when={d().state !== 'suspended'}>
												<button
													type="button"
													class={styles.editBtn}
													onClick={async () => { await suspendMemE(d().id); load(); }}
												>
													挂起
												</button>
											</Show>
											<Show when={d().state === 'suspended'}>
												<button
													type="button"
													class={styles.editBtn}
													onClick={async () => { await unsuspendMemE(d().id); load(); }}
												>
													恢复
												</button>
											</Show>
											<button
												type="button"
												class={styles.deleteBtn}
												onClick={() => handleDelete(d().id)}
											>
												删除
											</button>
										</>
									)}
								</div>
							</>
						)}
					</Show>
				</div>
			</div>

			{/* 批量标签 Modal */}
			<Modal
				isOpen={showBatchTagModal()}
					onClose={() => setShowBatchTagModal(false)}
					title={batchTagMode() === "add" ? "批量添加标签" : batchTagMode() === "remove" ? "批量移除标签" : "批量设置标签"}
				>
					<p style={{ "margin-bottom": "var(--space-md)", "font-size": "var(--text-sm)", color: "var(--color-text-muted)" }}>
						对 {batchIds().size} 条记忆{batchTagMode() === "add" ? "添加" : batchTagMode() === "remove" ? "移除" : "设置"}标签
					</p>
					<TagSelector
						tags={[]}
						onAdd={batchTagMode() === "remove" ? handleBatchRemoveTag : handleBatchAddTag}
						onRemove={() => {}}
					/>
			</Modal>
		</div>
	);
}
