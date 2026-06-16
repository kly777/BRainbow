import {
    type Component,
    createResource,
    createSignal,
    For,
    Show,
} from "solid-js";
import type { Onto } from "../../apis/ontoApi.ts";
import { createOntoE, deleteOntoE, getOntosE } from "../../apis/ontoApi.ts";
import { getErrorMessage } from "../../apis/types/index.ts";
import { AsyncView } from "../../components/ui/AsyncView.tsx";
import styles from "./OntologyList.module.css";

const OntologyListPage: Component = () => {
    // 使用 createResource 加载本体数据
	    const [ontologies, { mutate, refetch }] = createResource(async () => {
	        try {
	            return await getOntosE();
	        } catch {
	            return [];
	        }
	    });

    const [searchQuery, setSearchQuery] = createSignal("");
    const [viewMode, setViewMode] = createSignal<"grid" | "list">("grid");

    // 创建本体相关状态
    const [showCreateModal, setShowCreateModal] = createSignal(false);
    const [newName, setNewName] = createSignal("");
    const [newDescription, setNewDescription] = createSignal("");
    const [isCreating, setIsCreating] = createSignal(false);
    const [createError, setCreateError] = createSignal("");
    // 正在删除的本体ID，用于防止重复删除
    const [deletingOntoId, setDeletingOntoId] = createSignal<number | null>(
        null,
    );

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

        createOntoE(name, description).then((newOnto) => {
                setNewName("");
                setNewDescription("");
                setShowCreateModal(false);
                const currentData = ontologies() || [];
                mutate([newOnto, ...currentData]);
                console.log("本体创建成功");
            }).catch((error: unknown) => {
                console.error("创建本体失败:", getErrorMessage(error));
                setCreateError(getErrorMessage(error));
            }).finally(() => {
                setIsCreating(false);
            });
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

            deleteOntoE(id).then(() => {
                    console.log("本体删除成功:", id);
                }).catch(() => {
                    if (ontoToDelete) mutate([...currentData]);
                }).finally(() => {
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
                                                        <strong>
                                                            {onto.name}
                                                        </strong>
                                                    </td>
                                                    <td
                                                        class={styles
                                                            .entityDescription}
                                                    >
                                                        {onto.description
                                                            ? onto.description
                                                                    .length > 80
                                                                ? `${
                                                                    onto.description
                                                                        .substring(
                                                                            0,
                                                                            80,
                                                                        )
                                                                }...`
                                                                : onto
                                                                    .description
                                                            : "-"}
                                                    </td>
                                                    <td>
                                                        <div
                                                            class={styles
                                                                .entityActions}
                                                        >
                                                            <button
                                                                type="button"
                                                                class={styles
                                                                    .deleteButton}
                                                                onClick={() =>
                                                                    handleDeleteOnto(
                                                                        onto.id,
                                                                    )}
                                                                disabled={deletingOntoId() ===
                                                                    onto.id}
                                                            >
                                                                {deletingOntoId() ===
                                                                        onto.id
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
                                            <h3 class={styles.entityName}>
                                                {onto.name}
                                            </h3>
                                            <span class={styles.entityType}>
                                                ID: {onto.id}
                                            </span>
                                        </div>

                                        <div class={styles.entityDescription}>
                                            <p>
                                                {onto.description || "暂无描述"}
                                            </p>
                                        </div>

                                        <div class={styles.entityActions}>
                                            <button
                                                type="button"
                                                class={styles.deleteButton}
                                                onClick={() =>
                                                    handleDeleteOnto(onto.id)}
                                                disabled={deletingOntoId() ===
                                                    onto.id}
                                            >
                                                {deletingOntoId() === onto.id
                                                    ? "删除中..."
                                                    : "删除"}
                                            </button>
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
                                <div class={styles.errorMessage}>
                                    {createError()}
                                </div>
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
                                    onInput={(e) =>
                                        setNewName(e.currentTarget.value)}
                                    placeholder="请输入本体名称"
                                    disabled={isCreating()}
                                />
                            </div>

                            <div class={styles.formGroup}>
                                <label
                                    for="onto-description"
                                    class={styles.formLabel}
                                >
                                    描述
                                </label>
                                <textarea
                                    id="onto-description"
                                    class={styles.formTextarea}
                                    value={newDescription()}
                                    onInput={(e) =>
                                        setNewDescription(
                                            e.currentTarget.value,
                                        )}
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
					padding: 20px;
					border-bottom: 1px solid var(--color-border-light);
				}
				.modalHeader h2 {
					margin: 0;
					font-size: 20px;
					color: var(--color-text);
				}
				.closeButton {
					background: none;
					border: none;
					font-size: 24px;
					cursor: pointer;
					color: var(--color-text-muted);
					padding: 4px 8px;
				}
				.closeButton:hover {
					color: var(--color-text);
				}
				.modalContent {
					padding: 20px;
				}
				.errorMessage {
					background-color: var(--color-danger-subtle);
					color: var(--color-danger);
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
					color: var(--color-text-secondary);
					font-size: 14px;
				}
				.formInput {
					width: 100%;
					padding: 10px 12px;
					border: 1px solid var(--color-border);
					border-radius: 4px;
					font-size: 14px;
					box-sizing: border-box;
				}
				.formInput:focus {
					outline: none;
					border-color: var(--color-accent);
					box-shadow: 0 0 0 3px oklch(0.62 0.21 257 / 0.1);
				}
				.formTextarea {
					width: 100%;
					padding: 10px 12px;
					border: 1px solid var(--color-border);
					border-radius: 4px;
					font-size: 14px;
					resize: vertical;
					font-family: inherit;
					box-sizing: border-box;
				}
				.formTextarea:focus {
					outline: none;
					border-color: var(--color-accent);
					box-shadow: 0 0 0 3px oklch(0.62 0.21 257 / 0.1);
				}
				.modalActions {
					display: flex;
					justify-content: flex-end;
					gap: 10px;
					padding: 20px;
					border-top: 1px solid var(--color-border-light);
				}
			`}
            </style>
        </div>
    );
};

export default OntologyListPage;
