// ── v2 管理表格：档案清单 ──

import { For, Show } from "solid-js";
import Badge from "../../../../components/ui/Badge.tsx";
import { fmtLocal, fmtRelative } from "../../../../lib/time.ts";
import type { MemItem, TagInfo } from "../../api.ts";
import * as styles from "./V2ManageTable.css.ts";

type SortField = "cue.created_at" | "difficulty" | "due_at" | "state";
type SortDir = "asc" | "desc";

interface PageMeta {
	page: number;
	total_pages: number;
	total: number;
}

interface Props {
	mems: MemItem[];
	batchIds: Set<number>;
	sortField: SortField;
	sortDir: SortDir;
	detailId: number | null;
	memTags: Map<number, TagInfo[]>;
	allSelected: boolean;
	loading: boolean;
	pageMeta: PageMeta;
	page: number;
	onToggleSort: (field: SortField) => void;
	onToggleBatch: (id: number) => void;
	onToggleAll: () => void;
	onSelectRow: (id: number) => void;
	onDelete: (id: number) => void;
	onPageChange: (page: number) => void;
}

function previewText(content: string): string {
	return content.slice(0, 50).replace(/\n/g, " ") || "（空）";
}

const SORT_COLUMNS: { field: SortField; label: string }[] = [
	{ field: "state", label: "状态" },
	{ field: "difficulty", label: "难度" },
	{ field: "due_at", label: "复习" },
	{ field: "cue.created_at", label: "创建" },
];

function SortIcon(props: { field: SortField; active: boolean; dir: SortDir }) {
	if (!props.active) return null;
	return <>{props.dir === "asc" ? " ▲" : " ▼"}</>;
}

export default function V2ManageTable(props: Props) {
	return (
		<Show
			when={!props.loading}
			fallback={<div class={styles.empty}>加载中…</div>}
		>
			<div class={styles.tableCard}>
				<div class={styles.tableScroll}>
					<table class={styles.table}>
						<thead>
							<tr>
								<th class={styles.thCb}>
									<input
										type="checkbox"
										checked={props.allSelected}
										onInput={props.onToggleAll}
									/>
								</th>
								<th class={styles.th}>线索</th>
								<th class={styles.th}>答案</th>
								<For each={SORT_COLUMNS}>
									{({ field, label }) => (
										<th
											class={styles.thSort}
											onClick={() => props.onToggleSort(field)}
										>
											{label}
											<SortIcon
												field={field}
												active={props.sortField === field}
												dir={props.sortDir}
											/>
										</th>
									)}
								</For>
								<th class={styles.th}>标签</th>
								<th class={styles.th} />
							</tr>
						</thead>
						<tbody>
							<For each={props.mems}>
								{(mem) => {
									const tags = () => props.memTags.get(mem.id) ?? [];
									return (
										<tr
											class={
												props.detailId === mem.id
													? styles.rowActive
													: styles.row
											}
										>
											<td class={styles.tdCb}>
												<input
													type="checkbox"
													checked={props.batchIds.has(mem.id)}
													onInput={() => props.onToggleBatch(mem.id)}
													onClick={(e) => e.stopPropagation()}
												/>
											</td>
											<td
												class={styles.td}
												onClick={() => props.onSelectRow(mem.id)}
												onKeyDown={(e) => {
													if (e.key === "Enter")
														props.onSelectRow(mem.id);
												}}
											>
												{previewText(mem.cue.content)}
											</td>
											<td
												class={styles.td}
												onClick={() => props.onSelectRow(mem.id)}
												onKeyDown={(e) => {
													if (e.key === "Enter")
														props.onSelectRow(mem.id);
												}}
											>
												{previewText(mem.target.content)}
											</td>
											<td class={styles.td}>
												<Badge
													variant={
														mem.state as
															| "new"
															| "learning"
															| "review"
															| "relearning"
															| "suspended"
													}
												>
													{mem.state}
													{mem.leeched && " ⚠️"}
												</Badge>
											</td>
											<td class={styles.tdNum}>
												{mem.difficulty.toFixed(2)}
											</td>
											<td class={styles.tdDue}>{fmtRelative(mem.due_at)}</td>
											<td class={styles.tdDue}>
												{fmtLocal(mem.cue.created_at)}
											</td>
											<td class={styles.td}>
												<div class={styles.cellTags}>
													<For each={tags().slice(0, 3)}>
														{(tag) => (
															<span class={styles.cellTag}>
																{tag.name}
															</span>
														)}
													</For>
													<Show when={tags().length > 3}>
														<span class={styles.cellTag}>
															+{tags().length - 3}
														</span>
													</Show>
												</div>
											</td>
											<td class={styles.tdAct}>
												<button
													type="button"
													class={styles.delBtn}
													onClick={(e) => {
														e.stopPropagation();
														props.onDelete(mem.id);
													}}
													title="删除"
												>
													✕
												</button>
											</td>
										</tr>
									);
								}}
							</For>
						</tbody>
					</table>
				</div>
			</div>

			{/* 分页 */}
			<Show when={props.pageMeta.total_pages > 1}>
				<div class={styles.pagination}>
					<button
						type="button"
						class={styles.pageBtn}
						disabled={props.page <= 1}
						onClick={() => props.onPageChange(props.page - 1)}
					>
						‹
					</button>
					<span class={styles.pageInfo}>
						{props.pageMeta.page} / {props.pageMeta.total_pages} · 共
						{props.pageMeta.total} 条
					</span>
					<button
						type="button"
						class={styles.pageBtn}
						disabled={props.page >= props.pageMeta.total_pages}
						onClick={() => props.onPageChange(props.page + 1)}
					>
						›
					</button>
				</div>
			</Show>
		</Show>
	);
}
