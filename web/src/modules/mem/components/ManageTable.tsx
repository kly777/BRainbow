// ── v2 管理表格：档案清单 ──

import { Badge } from "@components/ui";
import { PATHS } from "@config/paths";
import { fmtLocal, fmtRelative, parseUtc } from "@lib/utils";
import type { MemItem, TagInfo } from "@modules/mem";
import { A } from "@solidjs/router";
import { type Component, For, Show } from "solid-js";
import { memStateMeta } from "../lib/mem-manage-utils.ts";
import styles from "./ManageTable.module.css";

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
	/** 当前处于搜索/筛选状态（决定空态文案） */
	filtered: boolean;
	onToggleSort: (field: SortField) => void;
	onToggleBatch: (id: number) => void;
	onToggleAll: () => void;
	onSelectRow: (id: number) => void;
	onDelete: (id: number) => void;
	onPageChange: (page: number) => void;
}

interface TableHeadProps {
	allSelected: boolean;
	sortField: SortField;
	sortDir: SortDir;
	onToggleSort: (field: SortField) => void;
	onToggleAll: () => void;
}

interface TableBodyProps {
	mems: MemItem[];
	batchIds: Set<number>;
	detailId: number | null;
	memTags: Map<number, TagInfo[]>;
	filtered: boolean;
	onToggleBatch: (id: number) => void;
	onSelectRow: (id: number) => void;
	onDelete: (id: number) => void;
}

interface MemRowProps {
	mem: MemItem;
	batchIds: Set<number>;
	detailId: number | null;
	memTags: Map<number, TagInfo[]>;
	onToggleBatch: (id: number) => void;
	onSelectRow: (id: number) => void;
	onDelete: (id: number) => void;
}

interface MemTableProps {
	mems: MemItem[];
	batchIds: Set<number>;
	sortField: SortField;
	sortDir: SortDir;
	detailId: number | null;
	memTags: Map<number, TagInfo[]>;
	allSelected: boolean;
	filtered: boolean;
	onToggleSort: (field: SortField) => void;
	onToggleBatch: (id: number) => void;
	onToggleAll: () => void;
	onSelectRow: (id: number) => void;
	onDelete: (id: number) => void;
}

interface PaginationProps {
	pageMeta: PageMeta;
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

// 骨架屏行宽（%），模拟最终表格的行节奏
const SKELETON_WIDTHS = [82, 64, 91, 58, 76, 68];

const LoadingSkeleton: Component = () => (
	<div class={styles.tableCard} role="status" aria-label="记忆列表加载中">
		<div class={styles.skHead} aria-hidden="true">
			<span class={`skeleton ${styles.skCb}`} />
			<span class={`skeleton ${styles.skBar}`} />
			<span class={`skeleton ${styles.skBar}`} />
			<span class={`skeleton ${styles.skChip}`} />
		</div>
		<For each={SKELETON_WIDTHS}>
			{(w) => (
				<div class={styles.skRow} aria-hidden="true">
					<span class={`skeleton ${styles.skCb}`} />
					<span class={`skeleton ${styles.skBar}`} style={{ width: `${w}%` }} />
					<span
						class={`skeleton ${styles.skBar}`}
						style={{ width: `${Math.max(28, w - 34)}%` }}
					/>
					<span class={`skeleton ${styles.skChip}`} />
				</div>
			)}
		</For>
	</div>
);

const EmptyState: Component<{ filtered: boolean }> = (props) => (
	<tr>
		<td colspan={9}>
			<div class={styles.empty}>
				<p class={styles.emptyTitle}>
					{props.filtered ? "没有匹配的记忆" : "档案柜还是空的"}
				</p>
				<p class={styles.emptyHint}>
					<Show
						when={props.filtered}
						fallback={<A href={PATHS.memoryAdd}>添加第一张记忆卡</A>}
					>
						试试放宽搜索词，或切换状态、标签筛选。
					</Show>
				</p>
			</div>
		</td>
	</tr>
);

const TableHead: Component<TableHeadProps> = (props) => (
	<thead>
		<tr>
			<th class={styles.thCb}>
				<input
					type="checkbox"
					checked={props.allSelected}
					onInput={props.onToggleAll}
					aria-label="全选本页"
				/>
			</th>
			<th class={styles.th}>线索</th>
			<th class={styles.th}>答案</th>
			<For each={SORT_COLUMNS}>
				{({ field, label }) => (
					<th
						class={styles.thSort}
						aria-sort={
							props.sortField === field
								? props.sortDir === "asc"
									? "ascending"
									: "descending"
								: undefined
						}
					>
						<button
							type="button"
							class={styles.sortBtn}
							onClick={() => props.onToggleSort(field)}
						>
							{label}
							<Show when={props.sortField === field}>
								<span class={styles.sortIcon} aria-hidden="true">
									{props.sortDir === "asc" ? "▲" : "▼"}
								</span>
							</Show>
						</button>
					</th>
				)}
			</For>
			<th class={styles.th}>标签</th>
			<th class={styles.th}>
				<span class="sr-only">操作</span>
			</th>
		</tr>
	</thead>
);

const TableBody: Component<TableBodyProps> = (props) => (
	<tbody>
		<Show
			when={props.mems.length > 0}
			fallback={<EmptyState filtered={props.filtered} />}
		>
			<For each={props.mems}>
				{(mem) => (
					<MemRow
						mem={mem}
						batchIds={props.batchIds}
						detailId={props.detailId}
						memTags={props.memTags}
						onToggleBatch={props.onToggleBatch}
						onSelectRow={props.onSelectRow}
						onDelete={props.onDelete}
					/>
				)}
			</For>
		</Show>
	</tbody>
);

const MemRow: Component<MemRowProps> = (props) => {
	const tags = () => props.memTags.get(props.mem.id) ?? [];
	const stateMeta = () => memStateMeta(props.mem.state);
	const overdue = () => parseUtc(props.mem.due_at).getTime() < Date.now();
	return (
		<tr class={props.detailId === props.mem.id ? styles.rowActive : styles.row}>
			<td class={styles.tdCb}>
				<input
					type="checkbox"
					checked={props.batchIds.has(props.mem.id)}
					onInput={() => props.onToggleBatch(props.mem.id)}
					onClick={(e) => e.stopPropagation()}
					aria-label={`选中：${previewText(props.mem.cue.content)}`}
				/>
			</td>
			<td class={styles.td}>
				<button
					type="button"
					class={styles.cellButton}
					onClick={() => props.onSelectRow(props.mem.id)}
				>
					{previewText(props.mem.cue.content)}
				</button>
			</td>
			<td class={styles.td}>
				<button
					type="button"
					class={styles.cellButton}
					onClick={() => props.onSelectRow(props.mem.id)}
				>
					{previewText(props.mem.target.content)}
				</button>
			</td>
			<td class={styles.tdState}>
				<span class={styles.stateCell}>
					<Badge variant={stateMeta().badge}>{stateMeta().label}</Badge>
					<Show when={props.mem.leeched}>
						<span class={styles.leechMark} title="烂卡：多次遗忘">
							烂卡
						</span>
					</Show>
				</span>
			</td>
			<td class={`${styles.tdDue} ${overdue() ? styles.tdOverdue : ""}`}>
				{fmtRelative(props.mem.due_at)}
			</td>
			<td class={styles.tdDue}>{fmtLocal(props.mem.cue.created_at)}</td>
			<td class={styles.td}>
				<div class={styles.cellTags}>
					<For each={tags().slice(0, 3)}>
						{(tag) => <span class={styles.cellTag}>{tag.name}</span>}
					</For>
					<Show when={tags().length > 3}>
						<span class={styles.cellTag}>+{tags().length - 3}</span>
					</Show>
				</div>
			</td>
			<td class={styles.tdAct}>
				<button
					type="button"
					class={styles.delBtn}
					onClick={(e) => {
						e.stopPropagation();
						props.onDelete(props.mem.id);
					}}
					title="删除"
					aria-label={`删除记忆：${previewText(props.mem.cue.content)}`}
				>
					✕
				</button>
			</td>
		</tr>
	);
};

const MemTable: Component<MemTableProps> = (props) => (
	<div class={styles.tableScroll}>
		<table class={styles.table}>
			<caption class="sr-only">记忆清单</caption>
			<TableHead
				allSelected={props.allSelected}
				onToggleAll={props.onToggleAll}
				sortField={props.sortField}
				sortDir={props.sortDir}
				onToggleSort={props.onToggleSort}
			/>
			<TableBody
				mems={props.mems}
				batchIds={props.batchIds}
				detailId={props.detailId}
				memTags={props.memTags}
				filtered={props.filtered}
				onToggleBatch={props.onToggleBatch}
				onSelectRow={props.onSelectRow}
				onDelete={props.onDelete}
			/>
		</table>
	</div>
);

const Pagination: Component<PaginationProps> = (props) => {
	const meta = () => props.pageMeta;
	return (
		<Show when={meta().total_pages > 1}>
			<nav class={styles.pagination} aria-label="分页">
				<button
					type="button"
					class={styles.pageBtn}
					disabled={meta().page <= 1}
					onClick={() => props.onPageChange(meta().page - 1)}
					aria-label="上一页"
				>
					‹
				</button>
				<span class={styles.pageInfo}>
					{meta().page} / {meta().total_pages} · 共 {meta().total} 条
				</span>
				<button
					type="button"
					class={styles.pageBtn}
					disabled={meta().page >= meta().total_pages}
					onClick={() => props.onPageChange(meta().page + 1)}
					aria-label="下一页"
				>
					›
				</button>
			</nav>
		</Show>
	);
};

export default function ManageTable(props: Props) {
	return (
		<Show when={!props.loading} fallback={<LoadingSkeleton />}>
			<div class={styles.tableCard}>
				<MemTable
					mems={props.mems}
					batchIds={props.batchIds}
					sortField={props.sortField}
					sortDir={props.sortDir}
					detailId={props.detailId}
					memTags={props.memTags}
					allSelected={props.allSelected}
					filtered={props.filtered}
					onToggleSort={props.onToggleSort}
					onToggleBatch={props.onToggleBatch}
					onToggleAll={props.onToggleAll}
					onSelectRow={props.onSelectRow}
					onDelete={props.onDelete}
				/>
			</div>
			{/* 分页（pageMeta 唯一权威） */}
			<Pagination pageMeta={props.pageMeta} onPageChange={props.onPageChange} />
		</Show>
	);
}
