import { Effect } from "effect";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import type { Onto } from "@/apis/ontoApi";
import { createOnto, deleteOnto, getOntos } from "@/apis/ontoApi";
import { getErrorMessage } from "@/apis/types";
import styles from "./OntologyList.module.css";

const OntologyListPage: Component = () => {
	// 使用 createResource 加载本体数据
	const [ontologies, { mutate, refetch }] = createResource(() =>
		Effect.runPromise(
			getOntos().pipe(
				Effect.catchAll((error) => {
					console.error("获取本体列表失败:", getErrorMessage(error));
					// 全局 toast 已触发，降级返回空列表
					return Effect.succeed([] as readonly Onto[]);
				}),
			),
		),
	);

	const [searchQuery, setSearchQuery] = createSignal("");
	const [viewMode, setViewMode] = createSignal<"grid" | "list">("grid");

	// 创建本体相关状态
	const [showCreateModal, setShowCreateModal] = createSignal(false);
	const [newName, setNewName] = createSignal("");
	const [newDescription, setNewDescription] = createSignal("");
	const [isCreating, setIsCreating] = createSignal(false);
	const [createError, setCreateError] = createSignal("");
	// 正在删除的本体ID，用于防止重复删除
	const [deletingOntoId, setDeletingOntoId] = createSignal<number | null>(null);

	// 过滤本体
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

		Effect.runPromise(
			createOnto(name, description).pipe(
				Effect.tap((newOnto) => {
					// 清空表单并关闭模态框
					setNewName("");
					setNewDescription("");
					setShowCreateModal(false);

					// 乐观更新：立即将新本体添加到资源状态
					const currentData = ontologies() || [];
					mutate([newOnto, ...currentData]);

					console.log("本体创建成功");
				}),
				Effect.catchAll((error) => {
					console.error("创建本体失败:", error);
					setCreateError(getErrorMessage(error));
					return Effect.void;
				}),
				Effect.ensuring(
					Effect.sync(() => {
						setIsCreating(false);
					}),
				),
			),
		);
	};

	const handleDeleteOnto = async (id: number) => {
		if (confirm("确定要删除这个本体吗？此操作不可撤销。")) {
			// 防止重复删除
			if (deletingOntoId() === id) return;

			setDeletingOntoId(id);

			// 乐观更新：立即从资源状态中移除
			const currentData = ontologies() || [];
			const ontoToDelete = currentData.find((onto) => onto.id === id);
			if (ontoToDelete) {
				mutate(currentData.filter((onto) => onto.id !== id));
			}

			Effect.runPromise(
				deleteOnto(id).pipe(
					Effect.tap(() => {
						console.log("本体删除成功:", id);
					}),
					Effect.catchAll((error) => {
						console.error("删除本体失败:", getErrorMessage(error));
						// 回滚乐观删除
						if (ontoToDelete) mutate([...currentData]);
						return Effect.void;
					}),
					Effect.ensuring(
						Effect.sync(() => {
							setDeletingOntoId(null);
						}),
					),
				),
			);
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
					<button
						type="button"
						class={styles.primaryButton}
						onClick={openCreateModal}
					>
						新建本体
					</button>
				</div>
			</div>

			<div class={styles.filters}>
				<div class={styles.searchSection}>
					<input
						type="text"
						class={styles.searchInput}
						placeholder="搜索本体名称或描述..."
						value={searchQuery()}
						onInput={(e) => setSearchQuery(e.currentTarget.value)}
					/>
				</div>

				<div class={styles.filterControls}>
					<div class={styles.viewToggle}>
						<button
							type="button"
							class={`${styles.viewButton} ${
								viewMode() === "grid" ? styles.active : ""
							}`}
							onClick={() => setViewMode("grid")}
						>
							网格视图
						</button>
						<button
							type="button"
							class={`${styles.viewButton} ${
								viewMode() === "list" ? styles.active : ""
							}`}
							onClick={() => setViewMode("list")}
						>
							列表视图
						</button>
					</div>
				</div>
			</div>

			<Show when={ontologies.loading}>
				<div class={styles.emptyState}>
					<p>加载中...</p>
				</div>
			</Show>

			<Show when={ontologies.error}>
				<div class={styles.emptyState}>
					<p>加载失败: {getErrorMessage(ontologies.error)}</p>
					<button
						type="button"
						class={styles.primaryButton}
						onClick={() => refetch()}
					>
						重试
					</button>
				</div>
			</Show>

			<Show
				when={
					!ontologies.loading &&
					!ontologies.error &&
					filteredOntologies().length > 0
				}
				fallback={
					<Show when={!ontologies.loading && !ontologies.error}>
						<div class={styles.emptyState}>
							<p>没有找到匹配的本体</p>
							<button
								type="button"
								class={styles.primaryButton}
								onClick={openCreateModal}
							>
								创建第一个本体
							</button>
						</div>
					</Show>
				}
			>
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
														<button
															type="button"
															class={styles.deleteButton}
															onClick={() => handleDeleteOnto(onto.id)}
															disabled={deletingOntoId() === onto.id}
														>
															{deletingOntoId() === onto.id
																? "删除中..."
																: "删除"}
														</button>
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
										<button
											type="button"
											class={styles.deleteButton}
											onClick={() => handleDeleteOnto(onto.id)}
											disabled={deletingOntoId() === onto.id}
										>
											{deletingOntoId() === onto.id ? "删除中..." : "删除"}
										</button>
									</div>
								</div>
							)}
						</For>
					</div>
				</Show>
			</Show>

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
							<button
								type="button"
								class={styles.closeButton}
								onClick={closeCreateModal}
								aria-label="关闭"
							>
								×
							</button>
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
							<button
								type="button"
								class={styles.secondaryButton}
								onClick={closeCreateModal}
								disabled={isCreating()}
							>
								取消
							</button>
							<button
								type="button"
								class={styles.primaryButton}
								onClick={handleCreateOnto}
								disabled={isCreating()}
							>
								{isCreating() ? "创建中..." : "创建"}
							</button>
						</div>
					</div>
				</div>
			</Show>

			{/* 模态框样式 */}
			<style>{`
				.modalOverlay {
					position: fixed;
					top: 0;
					left: 0;
					right: 0;
					bottom: 0;
					background-color: rgba(0, 0, 0, 0.5);
					display: flex;
					justify-content: center;
					align-items: center;
					z-index: 1000;
				}
				.modal {
					background-color: white;
					border-radius: 8px;
					width: 90%;
					max-width: 500px;
					box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
				}
				.modalHeader {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding: 20px;
					border-bottom: 1px solid #e9ecef;
				}
				.modalHeader h2 {
					margin: 0;
					font-size: 20px;
					color: #333;
				}
				.closeButton {
					background: none;
					border: none;
					font-size: 24px;
					cursor: pointer;
					color: #6c757d;
					padding: 4px 8px;
				}
				.closeButton:hover {
					color: #333;
				}
				.modalContent {
					padding: 20px;
				}
				.errorMessage {
					background-color: #fff3f3;
					color: #dc3545;
					padding: 10px;
					border-radius: 4px;
					margin-bottom: 15px;
					font-size: 14px;
				}
				.formGroup {
					margin-bottom: 15px;
				}
				.formLabel {
					display: block;
					margin-bottom: 6px;
					font-weight: 500;
					color: #495057;
					font-size: 14px;
				}
				.formInput {
					width: 100%;
					padding: 10px 12px;
					border: 1px solid #dee2e6;
					border-radius: 4px;
					font-size: 14px;
					box-sizing: border-box;
				}
				.formInput:focus {
					outline: none;
					border-color: #0066cc;
					box-shadow: 0 0 0 3px rgba(0, 102, 204, 0.1);
				}
				.formTextarea {
					width: 100%;
					padding: 10px 12px;
					border: 1px solid #dee2e6;
					border-radius: 4px;
					font-size: 14px;
					resize: vertical;
					font-family: inherit;
					box-sizing: border-box;
				}
				.formTextarea:focus {
					outline: none;
					border-color: #0066cc;
					box-shadow: 0 0 0 3px rgba(0, 102, 204, 0.1);
				}
				.modalActions {
					display: flex;
					justify-content: flex-end;
					gap: 10px;
					padding: 20px;
					border-top: 1px solid #e9ecef;
				}
			`}</style>
		</div>
	);
};

export default OntologyListPage;
