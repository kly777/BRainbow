// ── 记忆管理页面（薄壳视图层）──

import { A } from "@solidjs/router";
import { useMemManage } from "./logic/useMemManage.ts";
import MemBatchBar from "./ui/MemBatchBar.tsx";
import MemBatchTagModal from "./ui/MemBatchTagModal.tsx";
import MemDetailPanel from "./ui/MemDetailPanel.tsx";
import MemExportModal from "./ui/MemExportModal.tsx";
import MemManageToolbar from "./ui/MemManageToolbar.tsx";
import MemTable from "./ui/MemTable.tsx";
import styles from "./MemManage.module.css";

export default function MemManage() {
	const m = useMemManage();

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
					<span class={styles.count}>{m.pageMeta().total} 个</span>
				</div>
			</div>

			<MemManageToolbar
				searchQuery={m.searchQuery()}
				filterState={m.filterState()}
				onSearch={m.handleSearchInput}
				onFilterChange={m.setFilter}
				onExport={() => m.setShowExportModal(true)}
				tagFilters={m.tagFilters()}
				tagMode={m.tagMode()}
				onTagFiltersChange={m.setTagFilters}
			/>

			<div
				class={styles.split}
				classList={{ [styles.detailActive]: m.detailId() !== null }}
			>
				<div class={styles.tableWrap}>
					<MemBatchBar
						selectedCount={m.batchIds().size}
						onReset={m.batchReset}
						onBury={m.batchBury}
						onTag={() => {
							m.setShowBatchTagModal(true);
						}}
						onTagRemove={() => {
							m.setShowBatchTagModal(true);
						}}
						onDelete={m.batchDelete}
					/>
					<MemTable
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
				<MemDetailPanel
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
