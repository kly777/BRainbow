import {
	AsyncView,
	Button,
	FilterGroup,
	PageHead,
	SearchInput,
} from "@components/ui";
import { type Component, For, Show } from "solid-js";
import { CreateOntoModal } from "./components/CreateOntoModal.tsx";
import { type OntologyItem, useOntologyList } from "./hooks/useOntologyList.ts";
import styles from "./OntologyList.module.css";

const OntologyTableRow: Component<{
	onto: OntologyItem;
	deletingOntoId: number | null;
	onDelete: (id: number) => void;
}> = (props) => (
	<tr>
		<td>{props.onto.id}</td>
		<td>
			<strong>{props.onto.name}</strong>
		</td>
		<td class={styles.entityDescription}>
			{props.onto.description
				? props.onto.description.length > 80
					? `${props.onto.description.substring(0, 80)}...`
					: props.onto.description
				: "-"}
		</td>
		<td>
			<div class={styles.entityActions}>
				<Button
					variant="danger"
					size="sm"
					onClick={() => props.onDelete(props.onto.id)}
					disabled={props.deletingOntoId === props.onto.id}
				>
					{props.deletingOntoId === props.onto.id ? "删除中..." : "删除"}
				</Button>
			</div>
		</td>
	</tr>
);

const OntologyTable: Component<{
	data: readonly OntologyItem[];
	deletingOntoId: number | null;
	onDelete: (id: number) => void;
}> = (props) => (
	<div class={styles.entitiesList}>
		<table class={styles.entitiesTable}>
			<thead>
				<tr>
					<th>ID</th>
					<th>名称</th>
					<th>描述</th>
					<th>操作</th>
				</tr>
			</thead>
			<tbody>
				<For each={props.data}>
					{(onto) => (
						<OntologyTableRow
							onto={onto}
							deletingOntoId={props.deletingOntoId}
							onDelete={props.onDelete}
						/>
					)}
				</For>
			</tbody>
		</table>
	</div>
);

const OntologyCard: Component<{
	onto: OntologyItem;
	deletingOntoId: number | null;
	onDelete: (id: number) => void;
}> = (props) => (
	<div class={styles.entityCard}>
		<div class={styles.entityHeader}>
			<h3 class={styles.entityName}>{props.onto.name}</h3>
			<span class={styles.entityType}>ID: {props.onto.id}</span>
		</div>
		<p class={styles.entityDescription}>
			{props.onto.description || "暂无描述"}
		</p>
		<div class={styles.entityActions}>
			<Button
				variant="danger"
				size="sm"
				onClick={() => props.onDelete(props.onto.id)}
				disabled={props.deletingOntoId === props.onto.id}
			>
				{props.deletingOntoId === props.onto.id ? "删除中..." : "删除"}
			</Button>
		</div>
	</div>
);

const OntologyGrid: Component<{
	data: readonly OntologyItem[];
	deletingOntoId: number | null;
	onDelete: (id: number) => void;
}> = (props) => (
	<div class={styles.entitiesGrid}>
		<For each={props.data}>
			{(onto) => (
				<OntologyCard
					onto={onto}
					deletingOntoId={props.deletingOntoId}
					onDelete={props.onDelete}
				/>
			)}
		</For>
	</div>
);

const OntologyListPage: Component = () => {
	const m = useOntologyList();

	return (
		<div class={styles.container}>
			<PageHead
				title="知识管理"
				actions={
					<Button variant="primary" onClick={m.openCreateModal}>
						新建本体
					</Button>
				}
			/>

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

			<AsyncView
				data={m.filteredOntologies()}
				loading={m.loading}
				error={m.error}
				onRetry={m.refetch}
				emptyMessage="没有找到匹配的本体"
			>
				{(_data) => (
					<Show
						when={m.viewMode() === "grid"}
						fallback={
							<OntologyTable
								data={m.filteredOntologies()}
								deletingOntoId={m.deletingOntoId()}
								onDelete={m.handleDeleteOnto}
							/>
						}
					>
						<OntologyGrid
							data={m.filteredOntologies()}
							deletingOntoId={m.deletingOntoId()}
							onDelete={m.handleDeleteOnto}
						/>
					</Show>
				)}
			</AsyncView>

			<div class={styles.stats}>
				<p>共 {m.filteredOntologies().length} 个本体</p>
			</div>

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
		</div>
	);
};

export default OntologyListPage;
