import { useNavigate } from "@solidjs/router";
import { Effect } from "effect";
import { type Component, createResource, createSignal, Show } from "solid-js";
import { createCard, deleteCard, getCards, searchCards } from "@/apis/cardApi";
import { type CreateCardRequest, getErrorMessage } from "@/apis/types";

import CardsGrid from "@/components/CardsGrid";
import styles from "./CardsList.module.css";

const CardsListPage: Component = () => {
	const navigate = useNavigate();

	const [cards, { mutate }] = createResource(() =>
		Effect.runPromise(
			getCards().pipe(
				Effect.catchAll((error) => {
					console.error("获取卡片列表失败:", error);
					alert(`获取卡片列表失败: ${getErrorMessage(error)}`);
					return Effect.succeed([]);
				}),
			),
		),
	);

	const [showCreateModal, setShowCreateModal] = createSignal(false);
	const [newCardContent, setNewCardContent] = createSignal("");
	const [isCreating, setIsCreating] = createSignal(false);
	const [error, setError] = createSignal("");
	// 正在删除的卡片ID，用于防止重复删除
	const [deletingCardId, setDeletingCardId] = createSignal<number | null>(null);

	// 处理卡片点击
	const handleCardClick = (id: number) => {
		console.log("查看卡片:", id);
		// 跳转到卡片详情页面
		navigate(`/c/${id}`);
	};

	// 处理卡片编辑
	const handleCardEdit = (id: number) => {
		console.log("编辑卡片:", id);
		// 跳转到卡片编辑页面
		navigate(`/c/edit/${id}`);
	};

	// 处理卡片删除 - 乐观更新
	const handleCardDelete = async (id: number) => {
		if (confirm("确定要删除这个卡片吗？此操作不可撤销。")) {
			// 防止重复删除
			if (deletingCardId() === id) return;

			setDeletingCardId(id);

			// 乐观更新：立即从资源状态中移除卡片
			const currentCards = cards() || [];
			const cardToDelete = currentCards.find((card) => card.id === id);
			if (cardToDelete) {
				mutate(currentCards.filter((card) => card.id !== id));
			}

			// 使用Effect处理删除操作
			Effect.runPromise(
				deleteCard(id).pipe(
					Effect.tap(() => {
						console.log("卡片删除成功:", id);
					}),
					Effect.catchAll((error) => {
						console.error("删除卡片失败:", error);
						// 如果API调用失败，恢复被删除的卡片
						if (cardToDelete) {
							mutate([...currentCards]);
						}
						alert(`删除卡片失败: ${getErrorMessage(error)}`);
						return Effect.void;
					}),
					Effect.ensuring(
						Effect.sync(() => {
							setDeletingCardId(null);
						}),
					),
				),
			);
		}
	};

	// 处理创建卡片
	const handleCreateCard = async () => {
		if (!newCardContent().trim()) {
			setError("内容不能为空");
			return;
		}

		setIsCreating(true);
		setError("");

		const request: CreateCardRequest = {
			content: newCardContent().trim(),
		};

		// 使用Effect处理创建操作
		Effect.runPromise(
			createCard(request).pipe(
				Effect.tap((newCard) => {
					// 清空表单并关闭模态框
					setNewCardContent("");
					setShowCreateModal(false);

					// 乐观更新：立即将新卡片添加到资源状态
					const currentCards = cards() || [];
					mutate([newCard, ...currentCards]);

					console.log("卡片创建成功");
				}),
				Effect.catchAll((error) => {
					const msg = getErrorMessage(error);
					console.error("创建卡片失败:", msg);
					setError(`创建卡片失败: ${msg}`);
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

	// 搜索
	const handleSearch = async (query: string) => {
		if (!query) {
			// 空查询 = 重新加载全部
			const loaded = await Effect.runPromise(
				getCards().pipe(Effect.catchAll(() => Effect.succeed([]))),
			);
			mutate([...loaded]);
			return;
		}
		try {
			const results = await Effect.runPromise(searchCards(query));
			mutate([...results]);
		} catch (error) {
			console.error("搜索失败:", error);
		}
	};

	// 打开创建模态框
	const openCreateModal = () => {
		setNewCardContent("");
		setError("");
		setShowCreateModal(true);
	};

	// 关闭创建模态框
	const closeCreateModal = () => {
		setShowCreateModal(false);
		setError("");
	};

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<h1 class={styles.title}>卡片列表</h1>
				<div class={styles.actions}>
					<button
						type="button"
						class={styles.primaryButton}
						onClick={openCreateModal}
					>
						新建卡片
					</button>
				</div>
			</div>

			<Show when={cards.loading}>
				<div class={styles.loading}>
					<p>加载中...</p>
				</div>
			</Show>

			<Show when={cards.error}>
				<div class={styles.error}>
					<p>加载失败: {cards.error?.toString()}</p>
					<button
						type="button"
						class={styles.primaryButton}
						onClick={() => window.location.reload()}
					>
						重试
					</button>
				</div>
			</Show>

			<Show when={!cards.loading && !cards.error}>
				<CardsGrid
					cards={[...(cards() || [])]}
					showFilters={true}
					onSearch={handleSearch}
					onCardClick={handleCardClick}
					onCardEdit={handleCardEdit}
					onCardDelete={handleCardDelete}
					emptyMessage="还没有卡片，点击上方按钮创建一个吧！"
					deletingCardId={deletingCardId()}
				/>
			</Show>

			{/* 创建卡片模态框 */}
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
					aria-label="创建新卡片"
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
							<h2>创建新卡片</h2>
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
							<Show when={error()}>
								<div class={styles.errorMessage}>{error()}</div>
							</Show>

							<div class={styles.formGroup}>
								<label for="card-content" class={styles.formLabel}>
									内容
								</label>
								<textarea
									id="card-content"
									class={styles.formTextarea}
									value={newCardContent()}
									onInput={(e) => setNewCardContent(e.currentTarget.value)}
									placeholder="请输入卡片内容"
									rows={6}
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
								onClick={handleCreateCard}
								disabled={isCreating()}
							>
								{isCreating() ? "创建中..." : "创建"}
							</button>
						</div>
					</div>
				</div>
			</Show>
		</div>
	);
};

export default CardsListPage;
