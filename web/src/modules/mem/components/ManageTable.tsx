// ── v2 管理表格：档案清单 ──

import { Badge } from "@components/ui";
import { fmtLocal, fmtRelative } from "@lib/utils";
import type { MemItem, TagInfo } from "@modules/mem";
import { type Component, For, Show } from "solid-js";
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

function SortIcon(props: { field: SortField; active: boolean; dir: SortDir }) {
	if (!props.active) return null;
	return <>{props.dir === "asc" ? " ▲" : " ▼"}</>;
}

const LoadingEmpty: Component = () => <div class={styles.empty}>加载中…</div>;

const EmptyRow: Component = () => (
	<tr>
		<td class={styles.empty} colspan={9}>
			暂无数据
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
				/>
			</th>
			<th class={styles.th}>线索</th>
			<th class={styles.th}>答案</th>
			<For each={SORT_COLUMNS}>
				{({ field, label }) => (
					<th class={styles.thSort} onClick={() => props.onToggleSort(field)}>
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
);

const TableBody: Component<TableBodyProps> = (props) => (
	<tbody>
		<Show when={props.mems.length > 0} fallback={<EmptyRow />}>
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
	return (
		<tr class={props.detailId === props.mem.id ? styles.rowActive : styles.row}>
			<td class={styles.tdCb}>
				<input
					type="checkbox"
					checked={props.batchIds.has(props.mem.id)}
					onInput={() => props.onToggleBatch(props.mem.id)}
					onClick={(e) => e.stopPropagation()}
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
			<td class={styles.td}>
				<Badge
					variant={
						props.mem.state as
							| "new"
							| "learning"
							| "review"
							| "relearning"
							| "suspended"
					}
				>
					{props.mem.state}
					{props.mem.leeched && " ⚠️"}
				</Badge>
			</td>
			<td class={styles.tdNum}>{props.mem.difficulty.toFixed(2)}</td>
			<td class={styles.tdDue}>{fmtRelative(props.mem.due_at)}</td>
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
					aria-label={`删除记忆 ${props.mem.id}`}
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
			<div class={styles.pagination}>
				<button
					type="button"
					class={styles.pageBtn}
					disabled={meta().page <= 1}
					onClick={() => props.onPageChange(meta().page - 1)}
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
				>
					›
				</button>
			</div>
		</Show>
	);
};

export default function ManageTable(props: Props) {
	return (
		<Show when={!props.loading} fallback={<LoadingEmpty />}>
			<div class={styles.tableCard}>
				<MemTable
					mems={props.mems}
					batchIds={props.batchIds}
					sortField={props.sortField}
					sortDir={props.sortDir}
					detailId={props.detailId}
					memTags={props.memTags}
					allSelected={props.allSelected}
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
