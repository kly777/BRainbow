// ── 记忆管理 v2：档案柜 ──
// 清单表格 = 档案索引 · 详情面板 = 档案卡
// 业务逻辑复用 useMemManage，此处只做视图层

import { A } from "@solidjs/router";
import { useMemManage } from "../logic/useMemManage.ts";
import * as styles from "./MemManageV2.css.ts";
import MemBatchTagModal from "../ui/MemBatchTagModal.tsx";
import MemExportModal from "../ui/MemExportModal.tsx";
import V2ManageBatchBar from "./ui/V2ManageBatchBar.tsx";
import V2ManageDetail from "./ui/V2ManageDetail.tsx";
import V2ManageTable from "./ui/V2ManageTable.tsx";
import V2ManageToolbar from "./ui/V2ManageToolbar.tsx";

export default function MemManageV2() {
	const m = useMemManage();

	return (
		<div class={styles.page}>
			{/* 头栏 */}
			<div class={styles.topBar}>
				<A href="/m" class={styles.backLink}>
					← 记忆
				</A>
				<h1 class={styles.title}>记忆管理</h1>
				<div class={styles.topActions}>
					<A href="/m/add" class={styles.addLink}>
						＋ 添加
					</A>
					<span class={styles.count}>{m.pageMeta().total} 个</span>
				</div>
			</div>

			{/* 工具栏 */}
			<V2ManageToolbar
				searchQuery={m.searchQuery()}
				filterState={m.filterState()}
				onSearch={m.handleSearchInput}
				onFilterChange={m.setFilter}
				onExport={() => m.setShowExportModal(true)}
				tagFilters={m.tagFilters()}
				tagMode={m.tagMode()}
				onTagFiltersChange={m.setTagFilters}
			/>

			{/* 批量操作条 */}
			<V2ManageBatchBar
				selectedCount={m.batchIds().size}
				onReset={m.batchReset}
				onBury={m.batchBury}
				onTag={() => m.setShowBatchTagModal(true)}
				onTagRemove={() => m.setShowBatchTagModal(true)}
				onDelete={m.batchDelete}
			/>

			{/* 清单 + 档案卡 */}
			<div
				class={styles.split}
				classList={{ [styles.detailActive]: m.detailId() !== null }}
			>
				<div class={styles.tableWrap}>
					<V2ManageTable
						mems={m.mems()}
						batchIds={m.batchIds()}
						sortField={m.sortField()}
						sortDir={m.sortDir()}
						detailId={m.detailId()}
						memTags={m.memTags()}
						allSelected={m.allSelected()}
						loading={m.loading()}
						pageMeta={m.pageMeta()}
						page={m.page()}
						onToggleSort={m.toggleSort}
						onToggleBatch={m.toggleBatch}
						onToggleAll={m.toggleAll}
						onSelectRow={m.setDetailId}
						onDelete={m.handleDelete}
						onPageChange={(p) => m.goToPage(p)}
					/>
				</div>
				<V2ManageDetail
					mem={m.detail()}
					memTags={m.tagsForDetail()}
					editing={m.editing()}
					editCue={m.editCue()}
					editTarget={m.editTarget()}
					onEditCueChange={m.setEditCue}
					onEditTargetChange={m.setEditTarget}
					onStartEdit={m.startEdit}
					onSaveEdit={m.saveEdit}
					onCancelEdit={() => m.setEditing(false)}
					onReset={m.handleReset}
					onSuspend={async (id) => {
						await m.suspendMemE(id);
					}}
					onUnsuspend={async (id) => {
						await m.unsuspendMemE(id);
					}}
					onDelete={m.handleDelete}
					onAddTag={m.addTag}
					onRemoveTag={m.removeTag}
					onClose={() => m.setDetailId(null)}
				/>
			</div>

			<MemExportModal
				isOpen={m.showExportModal()}
				onClose={() => m.setShowExportModal(false)}
			/>
			<MemBatchTagModal
				isOpen={m.showBatchTagModal()}
				onClose={() => m.setShowBatchTagModal(false)}
				mode={m.batchTagMode()}
				selectedCount={m.batchIds().size}
				onAddTag={m.handleBatchAddTag}
				onRemoveTag={m.handleBatchRemoveTag}
			/>
		</div>
	);
}
