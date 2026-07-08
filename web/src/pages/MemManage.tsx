import { createSignal, onMount, Show, For } from "solid-js";
import { A } from "@solidjs/router";
import {
	buryMemE,
	editMemE,
	getAllMemsE,
	deleteMemE,
	resetMemE,
	suspendMemE,
	unsuspendMemE,
	type MemItem,
} from "../apis/memApi.ts";
import MarkdownRenderer from "../components/ui/Markdown.tsx";
import MarkdownEditor from "../components/ui/MarkdownEditor.tsx";
import { fmtLocal, fmtRelative } from "../lib/time.ts";
import styles from "./MemManage.module.css";

type SortField = "cue.created_at" | "difficulty" | "due_at" | "state";
type SortDir = "asc" | "desc";

function compareMems(a: MemItem, b: MemItem, field: SortField, dir: SortDir): number {
	const mul = dir === "asc" ? 1 : -1;
	switch (field) {
		case "due_at":
		case "cue.created_at": {
			const va = new Date(field === "due_at" ? a.due_at : a.cue.created_at).getTime();
			const vb = new Date(field === "due_at" ? b.due_at : b.cue.created_at).getTime();
			return (va - vb) * mul;
		}
		case "difficulty":
			return (a.difficulty - b.difficulty) * mul;
		case "state":
			return a.state.localeCompare(b.state) * mul;
	}
}

async function loadAllMems(sortField: SortField, sortDir: SortDir): Promise<MemItem[]> {
	try {
		const res = await getAllMemsE(500);
		return [...res.items].sort((a, b) => compareMems(a, b, sortField, sortDir));
	} catch {
		return [];
	}
}

function previewText(content: string): string {
	return content.slice(0, 50).replace(/\n/g, " ") || "（空）";
}

export default function MemManage() {
	const [mems, setMems] = createSignal<MemItem[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [detailId, setDetailId] = createSignal<number | null>(null);
	const [sortField, setSortField] = createSignal<SortField>("due_at");
	const [sortDir, setSortDir] = createSignal<SortDir>("asc");
	const [batchIds, setBatchIds] = createSignal<Set<number>>(new Set());
	const [editing, setEditing] = createSignal(false);
	const [editCue, setEditCue] = createSignal("");
	const [editTarget, setEditTarget] = createSignal("");
	const [searchQuery, setSearchQuery] = createSignal("");
	const [filterState, setFilterState] = createSignal<string>("all");

	const filteredMems = () => {
		const raw = mems();
		const q = searchQuery().toLowerCase().trim();
		const st = filterState();
		const now = new Date();
		return raw.filter((m) => {
			if (st === "today_done") {
				if (m.state !== "review" || new Date(m.due_at) <= now) return false;
			} else if (st !== "all" && m.state !== st) return false;
			if (!q) return true;
			return (
				m.cue.content.toLowerCase().includes(q) ||
				m.target.content.toLowerCase().includes(q)
			);
		});
	};

	const allSelected = () =>
		filteredMems().length > 0 && batchIds().size === filteredMems().length;

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
			setBatchIds(new Set<number>(filteredMems().map((m) => m.id)));
		}
	};

	const setFilter = (st: string) => {
		setFilterState(st);
		setBatchIds(new Set<number>());
	};

	const load = async () => {
		setLoading(true);
		setMems(await loadAllMems(sortField(), sortDir()));
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
		// load() 在下一 tick 执行（signal 更新后自动触发 effect）
		// 但 Solid 的 signal 是同步的，load 需要等 setSortField 完成
		// 加 setTimeout 确保 signal 已更新
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
		for (const id of ids) {
			try {
				await deleteMemE(id);
			} catch {
				/* ignore */
			}
		}
		setBatchIds(new Set<number>());
		setDetailId(null);
		load();
	};

	const batchReset = async () => {
		const ids = [...batchIds()];
		if (ids.length === 0) return;
		if (!confirm(`确定重置 ${ids.length} 条记忆的记忆数据？`)) return;
		for (const id of ids) {
			try {
				await resetMemE(id);
			} catch {
				/* ignore */
			}
		}
		setBatchIds(new Set<number>());
		load();
	};

	const batchBury = async () => {
		const ids = [...batchIds()];
		if (ids.length === 0) return;
		if (!confirm(`确定埋葬 ${ids.length} 条记忆？（移至池底）`)) return;
		for (const id of ids) {
			try {
				await buryMemE(id);
			} catch {
				/* ignore */
			}
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
					<span class={styles.count}>{filteredMems().length}/{mems().length} 个</span>
				</div>
			</div>
			<div class={styles.toolbar}>
				<input
					type="search"
					class={styles.searchInput}
					placeholder="搜索线索或答案…"
					value={searchQuery()}
					onInput={(e) => { setSearchQuery(e.currentTarget.value); setBatchIds(new Set<number>()); }}
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
									<th class={styles.th} />
								</tr>
							</thead>
							<tbody>
								<For each={filteredMems()}>
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
		</div>
	);
}
