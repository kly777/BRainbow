import { useSearchParams } from "@solidjs/router";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import { createOntoE, deleteOntoE, getOntosE } from "./api.ts";
import { getErrorMessage } from "../../apis/types/index.ts";
import { notifyError, notifySuccess } from "../../lib/notify.ts";
import { AsyncView } from "../../components/ui/AsyncView.tsx";
import Button from "../../components/ui/Button.tsx";
import FilterGroup from "../../components/ui/FilterGroup.tsx";
import SearchInput from "../../components/ui/SearchInput.tsx";
import styles from "./OntologyList.module.css";

const OntologyListPage: Component = () => {
	const [ontologies, { mutate, refetch }] = createResource(async () => {
		try {
			return await getOntosE();
		} catch {
			return [];
		}
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

		createOntoE(name, description)
			.then((newOnto) => {
				setNewName("");
				setNewDescription("");
				setShowCreateModal(false);
				const currentData = ontologies() || [];
				mutate([newOnto, ...currentData]);
				notifySuccess("本体创建成功");
			})
			.catch((error: unknown) => {
				notifyError("创建本体失败", error);
				setCreateError(getErrorMessage(error));
			})
			.finally(() => {
				setIsCreating(false);
			});
	};

	const handleDeleteOnto = async (id: number) => {
		if (confirm("确定要删除这个本体吗？此操作不可撤销。")) {
			if (deletingOntoId() === id) return;

			setDeletingOntoId(id);

			const currentData = ontologies() || [];
			const ontoToDelete = currentData.find((onto) => onto.id === id);
			if (ontoToDelete) {
				mutate(currentData.filter((onto) => onto.id !== id));
			}

			deleteOntoE(id)
				.then(() => {
					notifySuccess("本体已删除");
				})
				.catch((error: unknown) => {
					notifyError("删除本体失败", error);
					if (ontoToDelete) mutate([...currentData]);
				})
				.finally(() => {
					setDeletingOntoId(null);
				});
		}
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
										<For each={filteredOntologies()}>
											{(onto) => (
												<tr>
													<td>{onto.id}</td>
													<td>
														<strong>{onto.name}</strong>
													</td>
													<td class={styles.entityDescription}>
														{onto.description
															? onto.description.length > 80
																? `${onto.description.substring(0, 80)}...`
																: onto.description
															: "-"}
													</td>
													<td>
														<div class={styles.entityActions}>
															<Button
																variant="danger"
																size="sm"
																onClick={() => handleDeleteOnto(onto.id)}
																disabled={deletingOntoId() === onto.id}
															>
																{deletingOntoId() === onto.id
																	? "删除中..."
																	: "删除"}
															</Button>
														</div>
													</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</div>
						}
					>
						<div class={styles.entitiesGrid}>
							<For each={filteredOntologies()}>
								{(onto) => (
									<div class={styles.entityCard}>
										<div class={styles.entityHeader}>
											<h3 class={styles.entityName}>{onto.name}</h3>
											<span class={styles.entityType}>ID: {onto.id}</span>
										</div>

										<div class={styles.entityDescription}>
											<p>{onto.description || "暂无描述"}</p>
										</div>

										<div class={styles.entityActions}>
											<Button
												variant="danger"
												size="sm"
												onClick={() => handleDeleteOnto(onto.id)}
												disabled={deletingOntoId() === onto.id}
											>
												{deletingOntoId() === onto.id ? "删除中..." : "删除"}
											</Button>
										</div>
									</div>
								)}
							</For>
						</div>
					</Show>
				)}
			</AsyncView>

			<div class={styles.stats}>
				<p>共 {filteredOntologies().length} 个本体</p>
			</div>

			{/* 创建本体模态框 */}
			<Show when={showCreateModal()}>
				<div
					class={styles.modalOverlay}
					onClick={closeCreateModal}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							closeCreateModal();
						}
					}}
					role="dialog"
					aria-modal="true"
					aria-label="创建新本体"
					tabIndex={-1}
				>
					<div
						class={styles.modal}
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								closeCreateModal();
							}
						}}
						role="document"
						tabIndex={-1}
					>
						<div class={styles.modalHeader}>
							<h2>创建新本体</h2>
							<Button variant="icon" onClick={closeCreateModal} title="关闭">
								×
							</Button>
						</div>

						<div class={styles.modalContent}>
							<Show when={createError()}>
								<div class={styles.errorMessage}>{createError()}</div>
							</Show>

							<div class={styles.formGroup}>
								<label for="onto-name" class={styles.formLabel}>
									名称
								</label>
								<input
									id="onto-name"
									type="text"
									class={styles.formInput}
									value={newName()}
									onInput={(e) => setNewName(e.currentTarget.value)}
									placeholder="请输入本体名称"
									disabled={isCreating()}
								/>
							</div>

							<div class={styles.formGroup}>
								<label for="onto-description" class={styles.formLabel}>
									描述
								</label>
								<textarea
									id="onto-description"
									class={styles.formTextarea}
									value={newDescription()}
									onInput={(e) => setNewDescription(e.currentTarget.value)}
									placeholder="请输入本体描述（可选）"
									rows={4}
									disabled={isCreating()}
								/>
							</div>
						</div>

						<div class={styles.modalActions}>
							<Button
								variant="secondary"
								onClick={closeCreateModal}
								disabled={isCreating()}
							>
								取消
							</Button>
							<Button
								variant="primary"
								onClick={handleCreateOnto}
								disabled={isCreating()}
							>
								{isCreating() ? "创建中..." : "创建"}
							</Button>
						</div>
					</div>
				</div>
			</Show>

			{/* 模态框样式 */}
			<style>
				{`
				.modalOverlay {
					position: fixed;
					top: 0;
					left: 0;
					right: 0;
					bottom: 0;
					background-color: var(--color-overlay);
					display: flex;
					justify-content: center;
					align-items: center;
					z-index: 1000;
				}
				.modal {
					background-color: var(--color-surface);
					border-radius: 8px;
					width: 90%;
					max-width: 500px;
					box-shadow: 0 4px 20px oklch(0 0 0 / 0.15);
				}
				.modalHeader {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding: var(--space-lg) 20px;
					border-bottom: 1px solid var(--color-border);
				}
				.modalHeader h2 {
					font-size: 1.125rem;
					font-weight: 600;
					margin: 0;
				}
				.modalContent {
					padding: var(--space-lg) 20px;
				}
				.modalActions {
					display: flex;
					justify-content: flex-end;
					gap: var(--space-sm);
					padding: var(--space-lg) 20px;
					border-top: 1px solid var(--color-border);
				}
				.formGroup {
					margin-bottom: var(--space-lg);
				}
				.formLabel {
					display: block;
					font-size: 0.875rem;
					font-weight: 500;
					margin-bottom: var(--space-sm);
					color: var(--color-text);
				}
				.formInput,
				.formTextarea {
					width: 100%;
					padding: var(--space-sm) 10px;
					font-size: 0.875rem;
					border: 1px solid var(--color-border);
					border-radius: var(--radius-sm);
					transition: all 0.2s ease;
					font-family: inherit;
				}
				.formInput:focus,
				.formTextarea:focus {
					outline: none;
					border-color: var(--color-accent);
					box-shadow: 0 0 0 3px var(--color-accent-ring, oklch(0.58 0.2 255 / 0.25));
				}
				.formTextarea {
					resize: vertical;
				}
				.errorMessage {
					padding: var(--space-sm) 10px;
					background: var(--color-danger-subtle);
					border: 1px solid var(--color-danger);
					border-radius: var(--radius-sm);
					color: var(--color-danger);
					font-size: 0.875rem;
					margin-bottom: var(--space-lg);
				}
				`}
			</style>
		</div>
	);
};

export default OntologyListPage;
