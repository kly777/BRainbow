import { useNavigate, useSearchParams } from "@solidjs/router";
import { type Component, createSignal, onMount, Show } from "solid-js";
import {
	createCardE,
	deleteCardE,
	getCardsE,
	searchCardsE,
} from "../../apis/cardApi.ts";
import {
	type Card,
	type CreateCardRequest,
	getErrorMessage,
} from "../../apis/types/index.ts";

import CardsGrid from "../../components/card/CardsGrid.tsx";
import Button from "../../components/ui/Button.tsx";
import MarkdownRenderer from "../../components/ui/Markdown.tsx";
import { showToast } from "../../components/ui/toastStore.ts";
import styles from "./CardsList.module.css";

const CardsListPage: Component = () => {
	const navigate = useNavigate();

	const [cards, setCards] = createSignal<Card[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<unknown>(null);

	onMount(async () => {
		try {
			const initialQ = searchQuery();
			const items = initialQ
				? (await searchCardsE(initialQ)).items
				: (await getCardsE()).items;
			setCards(items);
		} catch (e) {
			setError(e);
		} finally {
			setLoading(false);
		}
	});

	const loadCards = async () => {
		try {
			setCards((await getCardsE()).items);
		} catch {
			/* ignore */
		}
	};

	const [showCreateModal, setShowCreateModal] = createSignal(false);
	const [newCardContent, setNewCardContent] = createSignal("");
	const [searchParams, setSearchParams] = useSearchParams();
	const searchQuery = () => {
		const q = searchParams.q;
		return typeof q === "string" ? q : "";
	};
	const isSearchMode = () => searchQuery().trim().length > 0;
	const [isCreating, setIsCreating] = createSignal(false);
	const [modalError, setModalError] = createSignal("");
	const [deletingCardId, setDeletingCardId] = createSignal<number | null>(null);

	const handleCardClick = (id: number) => navigate(`/c/${id}`);
	const handleCardEdit = (id: number) => navigate(`/c/edit/${id}`);

	const handleCardDelete = async (id: number) => {
		if (!confirm("确定要删除这个卡片吗？此操作不可撤销。")) return;
		if (deletingCardId() === id) return;

		setDeletingCardId(id);

		const currentCards = cards() || [];
		const cardToDelete = currentCards.find((card) => card.id === id);
		if (cardToDelete) setCards(currentCards.filter((card) => card.id !== id));

		try {
			await deleteCardE(id);
			showToast({
				type: "success",
				title: "卡片已删除",
				message: "",
				duration: 3000,
			});
		} catch {
			if (cardToDelete) setCards([...currentCards]);
		} finally {
			setDeletingCardId(null);
		}
	};

	const handleCreateCard = async () => {
		if (!newCardContent().trim()) {
			setError("内容不能为空");
			return;
		}

		setIsCreating(true);
		setModalError("");

		const request: CreateCardRequest = { content: newCardContent().trim() };

		try {
			const newCard = await createCardE(request);
			setNewCardContent("");
			setShowCreateModal(false);
			setCards([newCard, ...cards()]);
			showToast({
				type: "success",
				title: "卡片已创建",
				message: "",
				duration: 3000,
			});
		} catch (err) {
			setModalError(getErrorMessage(err));
		} finally {
			setIsCreating(false);
		}
	};

	const handleSearch = async (query: string) => {
		setSearchParams({ q: query || undefined });
		if (!query) {
			await loadCards();
			return;
		}
		try {
			const result = await searchCardsE(query);
			setCards([...result.items]);
		} catch {
			// 全局 toast 已触发
		}
	};

	const openCreateModal = () => {
		setNewCardContent("");
		setModalError("");
		setShowCreateModal(true);
	};
	const closeCreateModal = () => {
		setShowCreateModal(false);
		setModalError("");
	};

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<h1 class={styles.title}>卡片列表</h1>
				<div class={styles.actions}>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => navigate("/c/add")}
					>
						＋ 新建
					</Button>
					<Button variant="primary" size="sm" onClick={openCreateModal}>
						快速创建
					</Button>
				</div>
			</div>

			<Show when={loading()}>
				<div class={styles.state}>加载中...</div>
			</Show>
			<Show when={error()}>
				<div class={styles.state}>
					<p class={styles.errorText}>加载失败</p>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => globalThis.location.reload()}
					>
						重试
					</Button>
				</div>
			</Show>
			<Show when={!loading() && !error()}>
				<CardsGrid
					cards={[...(cards() || [])]}
					showFilters
					onSearch={handleSearch}
					initialSearchQuery={searchQuery()}
					onCardClick={handleCardClick}
					onCardEdit={handleCardEdit}
					onCardDelete={handleCardDelete}
					emptyMessage={
						isSearchMode()
							? "没有找到匹配的卡片"
							: "还没有卡片，点击上方按钮创建一个吧！"
					}
					deletingCardId={deletingCardId()}
				/>
			</Show>

			<Show when={showCreateModal()}>
				<div
					class={styles.modalOverlay}
					onClick={closeCreateModal}
					onKeyDown={(e) => {
						if (e.key === "Escape") closeCreateModal();
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
							if (e.key === "Escape") closeCreateModal();
						}}
						role="document"
						tabIndex={-1}
					>
						<div class={styles.modalHeader}>
							<h2>创建新卡片</h2>
							<Button variant="icon" onClick={closeCreateModal} title="关闭">
								×
							</Button>
						</div>
						<div class={styles.modalContent}>
							<Show when={modalError()}>
								<div class={styles.errorMessage}>{modalError()}</div>
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
									placeholder="请输入卡片内容（支持 Markdown）"
									rows={6}
									disabled={isCreating()}
								/>
							</div>
							<Show when={newCardContent().trim()}>
								<div class={styles.previewSection}>
									<span class={styles.previewLabel}>预览</span>
									<div class={styles.previewContent}>
										<MarkdownRenderer content={newCardContent()} />
									</div>
								</div>
							</Show>
						</div>
						<div class={styles.modalActions}>
							<Button
								variant="secondary"
								size="sm"
								onClick={closeCreateModal}
								disabled={isCreating()}
							>
								取消
							</Button>
							<Button
								variant="primary"
								size="sm"
								onClick={handleCreateCard}
								disabled={isCreating()}
							>
								{isCreating() ? "创建中..." : "创建"}
							</Button>
						</div>
					</div>
				</div>
			</Show>
		</div>
	);
};

export default CardsListPage;
