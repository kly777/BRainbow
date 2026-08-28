import { PATHS } from "@config/paths";
import { ArrowLeft } from "lucide-solid";
// ── 记忆管理 v2：档案柜 ──
// 清单表格 = 档案索引 · 详情面板 = 档案卡
// 业务逻辑复用 useMemManage，此处只做视图层

import { A } from "@solidjs/router";
import { Show } from "solid-js";
import ManageBatchBar from "./components/ManageBatchBar.tsx";
import ManageDetail from "./components/ManageDetail.tsx";
import ManageTable from "./components/ManageTable.tsx";
import ManageToolbar from "./components/ManageToolbar.tsx";
import MemBatchTagModal from "./components/MemBatchTagModal.tsx";
import MemExportModal from "./components/MemExportModal.tsx";
import { useMemManage } from "./hooks/useMemManage.ts";
import styles from "./MemManage.module.css";

export default function MemManage() {
	const m = useMemManage();

	// 是否处于搜索/筛选态（决定表格空态文案）
	const filtered = () =>
		m.searchQuery().trim() !== "" ||
		m.filterState() !== "all" ||
		m.tagFilters().length > 0;

	return (
		<div class={styles.page}>
			{/* 头栏 */}
			<div class={styles.topBar}>
				<A href={PATHS.memory} class={styles.backLink}>
					<ArrowLeft size={14} /> 记忆
				</A>
				<h1 class={styles.title}>记忆管理</h1>
				<div class={styles.topActions}>
					<A href={PATHS.memoryAdd} class={styles.addLink}>
						＋ 添加
					</A>
					<span class={styles.count}>共 {m.pageMeta().total} 条</span>
				</div>
			</div>

			{/* 工具栏 */}
			<ManageToolbar
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
			<ManageBatchBar
				selectedCount={m.batchIds().size}
				onReset={m.batchReset}
				onBury={m.batchBury}
				onTag={() => {
					m.setBatchTagMode("add");
					m.setShowBatchTagModal(true);
				}}
				onTagRemove={() => {
					m.setBatchTagMode("remove");
					m.setShowBatchTagModal(true);
				}}
				onDelete={m.batchDelete}
			/>

			{/* 清单 + 档案卡 */}
			<div
				class={styles.split}
				classList={{ [styles.detailActive]: m.detailId() !== null }}
			>
				{/* 移动端抽屉遮罩（桌面端 display:none） */}
				<Show when={m.detailId() !== null}>
					<div
						class={styles.backdrop}
						onClick={() => m.setDetailId(null)}
						aria-hidden="true"
					/>
				</Show>
				<div class={styles.tableWrap}>
					<ManageTable
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
						filtered={filtered()}
						onToggleSort={m.toggleSort}
						onToggleBatch={m.toggleBatch}
						onToggleAll={m.toggleAll}
						onSelectRow={m.setDetailId}
						onDelete={m.handleDelete}
						onPageChange={(p) => m.goToPage(p)}
					/>
				</div>
				<ManageDetail
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
