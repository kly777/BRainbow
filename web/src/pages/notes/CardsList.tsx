import { useNavigate } from "@solidjs/router";
import { Effect } from "effect";
import { type Component, createResource, createSignal, Show } from "solid-js";
import { createCard, deleteCard, getCards, searchCards } from "@/apis/cardApi";
import { type CreateCardRequest, getErrorMessage } from "@/apis/types";

import CardsGrid from "@/components/CardsGrid";
import { AsyncView } from "@/components/AsyncView";
import styles from "./CardsList.module.css";

const emptyFallback = Effect.catchTags({
	HttpError: () => Effect.succeed([]),
	NetworkError: () => Effect.succeed([]),
	ValidationError: () => Effect.succeed([]),
});

const CardsListPage: Component = () => {
	const navigate = useNavigate();

	const [cards, { mutate }] = createResource(() =>
		Effect.runPromise(
			getCards().pipe(
				Effect.map((r) => r.items),
				emptyFallback,
			),
		),
	);

	const [showCreateModal, setShowCreateModal] = createSignal(false);
	const [newCardContent, setNewCardContent] = createSignal("");
	const [isCreating, setIsCreating] = createSignal(false);
	const [error, setError] = createSignal("");
	const [deletingCardId, setDeletingCardId] = createSignal<number | null>(null);

	const handleCardClick = (id: number) => navigate(`/c/${id}`);
	const handleCardEdit = (id: number) => navigate(`/c/edit/${id}`);

	const handleCardDelete = async (id: number) => {
		if (!confirm("确定要删除这个卡片吗？此操作不可撤销。")) return;
		if (deletingCardId() === id) return;

		setDeletingCardId(id);

		const currentCards = cards() || [];
		const cardToDelete = currentCards.find((card) => card.id === id);
		if (cardToDelete) mutate(currentCards.filter((card) => card.id !== id));

		Effect.runPromise(
			deleteCard(id).pipe(
				Effect.tap(() => console.log("卡片删除成功:", id)),
				Effect.catchTag("HttpError", () => {
					if (cardToDelete) mutate([...currentCards]);
					return Effect.void;
				}),
				Effect.ensuring(Effect.sync(() => setDeletingCardId(null))),
			),
		);
	};

	const handleCreateCard = async () => {
		if (!newCardContent().trim()) {
			setError("内容不能为空");
			return;
		}

		setIsCreating(true);
		setError("");

		const request: CreateCardRequest = { content: newCardContent().trim() };

		Effect.runPromise(
			createCard(request).pipe(
				Effect.tap((newCard) => {
					setNewCardContent("");
					setShowCreateModal(false);
					mutate([newCard, ...(cards() || [])]);
				}),
				Effect.catchTag("HttpError", (err) => {
					setError(getErrorMessage(err));
					return Effect.void;
				}),
				Effect.ensuring(Effect.sync(() => setIsCreating(false))),
			),
		);
	};

	const handleSearch = async (query: string) => {
		if (!query) {
			const loaded = await Effect.runPromise(
				getCards().pipe(Effect.map((r) => r.items), emptyFallback),
			);
			mutate([...loaded]);
			return;
		}
		try {
			const result = await Effect.runPromise(searchCards(query));
			mutate([...result.items]);
		} catch {
			// 全局 toast 已触发
		}
	};

	const openCreateModal = () => { setNewCardContent(""); setError(""); setShowCreateModal(true); };
	const closeCreateModal = () => { setShowCreateModal(false); setError(""); };

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<h1 class={styles.title}>卡片列表</h1>
				<div class={styles.actions}>
					<button type="button" class={styles.primaryButton} onClick={openCreateModal}>新建卡片</button>
				</div>
			</div>

			<AsyncView data={cards()} loading={cards.loading} error={cards.error} onRetry={() => window.location.reload()} emptyMessage="还没有卡片，点击上方按钮创建一个吧！">
			{(data) => (
				<Show when={!cards.loading && !cards.error}>
				<CardsGrid cards={[...(data || [])]} showFilters={true} onSearch={handleSearch} onCardClick={handleCardClick} onCardEdit={handleCardEdit} onCardDelete={handleCardDelete} emptyMessage="还没有卡片，点击上方按钮创建一个吧！" deletingCardId={deletingCardId()} />
			</Show>
			)}
			</AsyncView>

			<Show when={showCreateModal()}>
				<div class={styles.modalOverlay} onClick={closeCreateModal} onKeyDown={(e) => { if (e.key === "Escape") closeCreateModal(); }} role="dialog" aria-modal="true" aria-label="创建新卡片" tabIndex={-1}>
					<div class={styles.modal} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") closeCreateModal(); }} role="document" tabIndex={-1}>
						<div class={styles.modalHeader}><h2>创建新卡片</h2><button type="button" class={styles.closeButton} onClick={closeCreateModal} aria-label="关闭">×</button></div>
						<div class={styles.modalContent}>
							<Show when={error()}><div class={styles.errorMessage}>{error()}</div></Show>
							<div class={styles.formGroup}>
								<label for="card-content" class={styles.formLabel}>内容</label>
								<textarea id="card-content" class={styles.formTextarea} value={newCardContent()} onInput={(e) => setNewCardContent(e.currentTarget.value)} placeholder="请输入卡片内容" rows={6} disabled={isCreating()} />
							</div>
						</div>
						<div class={styles.modalActions}>
							<button type="button" class={styles.secondaryButton} onClick={closeCreateModal} disabled={isCreating()}>取消</button>
							<button type="button" class={styles.primaryButton} onClick={handleCreateCard} disabled={isCreating()}>{isCreating() ? "创建中..." : "创建"}</button>
						</div>
					</div>
				</div>
			</Show>
		</div>
	);
};

export default CardsListPage;
