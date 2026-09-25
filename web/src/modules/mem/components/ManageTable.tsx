// ── v2 管理表格：档案清单 ──
// 表格本体拆在 manage-table/ 下（表头 / 行 / 骨架 / 类型），这里只做容器：
// "加载中 → 卡片（表头 + 行）→ 分页"这段组合，以及空态。

import { EmptyState, SimplePagination } from "@components/ui";
import { PATHS } from "@config/paths";
import { A } from "@solidjs/router";
import { For, Show } from "solid-js";
import type { MemItem, TagInfo } from "../api.ts";
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

/**
 * 表格级操作收成一束（与行级的 `RowActions` 同一手法，见体检表"Props 超载"一条）：
 * 此前 6 个回调平铺在 props 里，调用点要逐个接线、加一个操作就改两处签名。
 */
export interface TableActions {
	onToggleSort: (field: SortField) => void;
	onToggleBatch: (id: number) => void;
	onToggleAll: () => void;
	onSelectRow: (id: number) => void;
	onDelete: (id: number) => void;
	onPageChange: (page: number) => void;
}

interface Props {
	mems: MemItem[];
	batchIds: Set<number>;
	detailId: number | null;
	memTags: Map<number, TagInfo[]>;
	allSelected: boolean;
	loading: boolean;
	/** 分页元信息（页码也从这里读，原先另有一个从未被使用的 `page` prop） */
	pageMeta: PageMeta;
	/** 当前处于搜索/筛选状态（决定空态文案） */
	filtered: boolean;
	sort: { field: SortField; dir: SortDir };
	actions: TableActions;
}

export default function ManageTable(props: Props) {
	// 行级操作再收窄一层：表格 → 行只传行真正用得上的那三个
	const actions: RowActions = {
		onToggleBatch: (id) => props.actions.onToggleBatch(id),
		onSelectRow: (id) => props.actions.onSelectRow(id),
		onDelete: (id) => props.actions.onDelete(id),
	};

	return (
		<Show when={!props.loading} fallback={<ManageTableSkeleton />}>
			<div class={styles.tableCard}>
				<div class={styles.tableScroll}>
					<table class={styles.table}>
						<caption class="sr-only">记忆清单</caption>
						<ManageTableHead
							allSelected={props.allSelected}
							sortField={props.sort.field}
							sortDir={props.sort.dir}
							onToggleSort={props.actions.onToggleSort}
							onToggleAll={props.actions.onToggleAll}
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
				onPrev={() => props.actions.onPageChange(props.pageMeta.page - 1)}
				onNext={() => props.actions.onPageChange(props.pageMeta.page + 1)}
			/>
		</Show>
	);
}
