import { Button, FilterGroup, ListPage, SearchInput } from "@components/ui";
import type { Component } from "solid-js";
import { Show } from "solid-js";
import { CreateOntoModal } from "./components/CreateOntoModal.tsx";
import OntologyGrid from "./components/OntologyGrid.tsx";
import OntologyTable from "./components/OntologyTable.tsx";
import { useOntologyList } from "./hooks/useOntologyList.ts";
import styles from "./OntologyList.module.css";

const OntologyListPage: Component = () => {
	const m = useOntologyList();

	return (
		<>
			<ListPage
				class={styles.container}
				title="知识管理"
				actions={
					<Button variant="primary" onClick={m.openCreateModal}>
						新建本体
					</Button>
				}
				filters={
					<div class={styles.filters}>
						<div class={styles.searchSection}>
							<SearchInput
								value={m.searchQuery()}
								onSearch={m.setSearchQuery}
								placeholder="搜索本体名称或描述..."
							/>
						</div>
						<FilterGroup
							options={[
								{ value: "grid", label: "网格视图" },
								{ value: "list", label: "列表视图" },
							]}
							selected={m.viewMode()}
							onChange={(v) => m.setViewMode(v as "grid" | "list")}
						/>
					</div>
				}
				data={m.filteredOntologies()}
				loading={m.loading()}
				error={m.error()}
				onRetry={m.refetch}
				emptyMessage="没有找到匹配的本体"
				footer={
					<div class={styles.stats}>
						<p>共 {m.filteredOntologies().length} 个本体</p>
					</div>
				}
			>
				{/* 数据走 children 给的 accessor：与 ListPage 一起保证
				    刷新时只做行级 diff，而不是整棵重挂 */}
				{(data) => (
					<Show
						when={m.viewMode() === "grid"}
						fallback={
							<OntologyTable
								data={data()}
								deletingId={m.deletingOntoId()}
								onDelete={m.handleDeleteOnto}
							/>
						}
					>
						<OntologyGrid
							data={data()}
							deletingId={m.deletingOntoId()}
							onDelete={m.handleDeleteOnto}
						/>
					</Show>
				)}
			</ListPage>

			<CreateOntoModal
				open={m.showCreateModal}
				name={m.newName}
				setName={m.setNewName}
				description={m.newDescription}
				setDescription={m.setNewDescription}
				creating={m.isCreating}
				error={m.createError}
				onCreate={m.handleCreateOnto}
				onClose={m.closeCreateModal}
			/>
		</>
	);
};

export default OntologyListPage;
