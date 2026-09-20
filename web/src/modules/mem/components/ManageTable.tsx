// ── v2 管理表格：档案清单 ──
// 表格本体拆在 manage-table/ 下（表头 / 行 / 骨架 / 类型），这里只做容器：
// "加载中 → 卡片（表头 + 行）→ 分页"这段组合，以及空态。

import { EmptyState, SimplePagination } from "@components/ui";
import { PATHS } from "@config/paths";
import type { MemItem, TagInfo } from "@modules/mem";
import { A } from "@solidjs/router";
import { For, Show } from "solid-js";
import styles from "./ManageTable.module.css";
import ManageTableHead from "./manage-table/ManageTableHead.tsx";
import ManageTableRow from "./manage-table/ManageTableRow.tsx";
import ManageTableSkeleton from "./manage-table/ManageTableSkeleton.tsx";
import type {
	PageMeta,
	RowActions,
	SortDir,
	SortField,
} from "./manage-table/types.ts";

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

export default function ManageTable(props: Props) {
	// 行级操作收成一束：穿过"表格 → 行"两层只传这一个对象
	const actions: RowActions = {
		onToggleBatch: (id) => props.onToggleBatch(id),
		onSelectRow: (id) => props.onSelectRow(id),
		onDelete: (id) => props.onDelete(id),
	};

	return (
		<Show when={!props.loading} fallback={<ManageTableSkeleton />}>
			<div class={styles.tableCard}>
				<div class={styles.tableScroll}>
					<table class={styles.table}>
						<caption class="sr-only">记忆清单</caption>
						<ManageTableHead
							allSelected={props.allSelected}
							sortField={props.sortField}
							sortDir={props.sortDir}
							onToggleSort={props.onToggleSort}
							onToggleAll={props.onToggleAll}
						/>
						<tbody>
							<Show
								when={props.mems.length > 0}
								fallback={
									<tr>
										<td colspan={8}>
											<EmptyState
												title={
													props.filtered ? "没有匹配的记忆" : "档案柜还是空的"
												}
												hint={
													props.filtered ? (
														"试试放宽搜索词，或切换状态、标签筛选。"
													) : (
														<A href={PATHS.memoryAdd}>添加第一张记忆卡</A>
													)
												}
											/>
										</td>
									</tr>
								}
							>
								<For each={props.mems}>
									{(mem) => (
										<ManageTableRow
											mem={mem}
											selected={props.batchIds.has(mem.id)}
											active={props.detailId === mem.id}
											tags={props.memTags.get(mem.id) ?? []}
											actions={actions}
										/>
									)}
								</For>
							</Show>
						</tbody>
					</table>
				</div>
			</div>
			<SimplePagination
				page={props.pageMeta.page}
				totalPages={props.pageMeta.total_pages}
				total={props.pageMeta.total}
				onPrev={() => props.onPageChange(props.pageMeta.page - 1)}
				onNext={() => props.onPageChange(props.pageMeta.page + 1)}
			/>
		</Show>
	);
}
