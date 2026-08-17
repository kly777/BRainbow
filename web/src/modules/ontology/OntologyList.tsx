import { AsyncView, Button, FilterGroup, SearchInput } from "@components/ui";
import { getErrorMessage } from "@lib/api";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
	tryOrNotify,
} from "@lib/utils";
import { useSearchParams } from "@solidjs/router";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import { createOntoE, deleteOntoE, getOntosE } from "./api";
import { CreateOntoModal } from "./components/CreateOntoModal.tsx";
import styles from "./OntologyList.module.css";

type OntologyItem = Awaited<ReturnType<typeof getOntosE>>[number];

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

		<div class={styles.entityDescription}>
			<p>{props.onto.description || "暂无描述"}</p>
		</div>

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
	const [ontologies, { mutate, refetch }] = createResource(async () => {
		const result = await tryAsync(() => getOntosE());
		if (result.ok) return result.value;
		throw result.error;
	});

	const [searchParams, setSearchParams] = useSearchParams();
	const searchQuery = () => {
		const q = searchParams.q;
		if (Array.isArray(q)) return q[0] ?? "";
		return q ?? "";
	};
	const setSearchQuery = (q: string) => setSearchParams({ q: q || undefined });
	const viewMode = () => {
		const v = searchParams.view;
		return (v === "list" ? "list" : "grid") as "grid" | "list";
	};
	const setViewMode = (v: "grid" | "list") =>
		setSearchParams({
			q: searchQuery() || undefined,
			view: v === "grid" ? undefined : v,
		});

	const [showCreateModal, setShowCreateModal] = createSignal(false);
	const [newName, setNewName] = createSignal("");
	const [newDescription, setNewDescription] = createSignal("");
	const [isCreating, setIsCreating] = createSignal(false);
	const [createError, setCreateError] = createSignal("");
	const [deletingOntoId, setDeletingOntoId] = createSignal<number | null>(null);

	const filteredOntologies = () => {
		const data = ontologies() || [];
		if (!searchQuery()) return data;
		const query = searchQuery().toLowerCase();
		return data.filter(
			(onto) =>
				onto.name.toLowerCase().includes(query) ||
				(onto.description ?? "").toLowerCase().includes(query),
		);
	};

	const handleCreateOnto = async () => {
		if (!newName().trim()) {
			setCreateError("名称不能为空");
			return;
		}

		setIsCreating(true);
		setCreateError("");

		const name = newName().trim();
		const description = newDescription().trim() || undefined;

		const result = await tryAsync(() => createOntoE(name, description));
		if (result.ok) {
			setNewName("");
			setNewDescription("");
			setShowCreateModal(false);
			const currentData = ontologies() || [];
			mutate([result.value, ...currentData]);
			notifySuccess("本体创建成功");
		} else {
			notifyError("创建本体失败", result.error);
			setCreateError(getErrorMessage(result.error));
		}
		setIsCreating(false);
	};

	const handleDeleteOnto = async (id: number) => {
		const confirmed = await showConfirm({
			title: "删除本体",
			message: "确定要删除这个本体吗？此操作不可撤销。",
			variant: "danger",
		});
		if (!confirmed) return;
		if (deletingOntoId() === id) return;

		setDeletingOntoId(id);

		const currentData = ontologies() || [];
		const ontoToDelete = currentData.find((onto) => onto.id === id);
		if (ontoToDelete) {
			mutate(currentData.filter((onto) => onto.id !== id));
		}

		const ok = await tryOrNotify(() => deleteOntoE(id), "删除本体");
		if (ok) {
			notifySuccess("本体已删除");
		} else {
			if (ontoToDelete) mutate([...currentData]);
		}
		setDeletingOntoId(null);
	};

	const openCreateModal = () => {
		setNewName("");
		setNewDescription("");
		setCreateError("");
		setShowCreateModal(true);
	};

	const closeCreateModal = () => {
		setShowCreateModal(false);
		setCreateError("");
	};

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<h1>知识管理</h1>
				<div class={styles.actions}>
					<Button variant="primary" onClick={openCreateModal}>
						新建本体
					</Button>
				</div>
			</div>

			<div class={styles.filters}>
				<div class={styles.searchSection}>
					<SearchInput
						value={searchQuery()}
						onSearch={setSearchQuery}
						placeholder="搜索本体名称或描述..."
					/>
				</div>

				<FilterGroup
					options={[
						{ value: "grid", label: "网格视图" },
						{ value: "list", label: "列表视图" },
					]}
					selected={viewMode()}
					onChange={(v) => setViewMode(v as "grid" | "list")}
				/>
			</div>

			<AsyncView
				data={filteredOntologies()}
				loading={ontologies.loading}
				error={ontologies.error}
				onRetry={refetch}
				emptyMessage="没有找到匹配的本体"
			>
				{(_data) => (
					<Show
						when={viewMode() === "grid"}
						fallback={
							<OntologyTable
								data={filteredOntologies()}
								deletingOntoId={deletingOntoId()}
								onDelete={handleDeleteOnto}
							/>
						}
					>
						<OntologyGrid
							data={filteredOntologies()}
							deletingOntoId={deletingOntoId()}
							onDelete={handleDeleteOnto}
						/>
					</Show>
				)}
			</AsyncView>

			<div class={styles.stats}>
				<p>共 {filteredOntologies().length} 个本体</p>
			</div>

			<CreateOntoModal
				open={showCreateModal}
				name={newName}
				setName={setNewName}
				description={newDescription}
				setDescription={setNewDescription}
				creating={isCreating}
				error={createError}
				onCreate={handleCreateOnto}
				onClose={closeCreateModal}
			/>
		</div>
	);
};

export default OntologyListPage;
