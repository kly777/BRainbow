// ── 卡片列表核心业务逻辑 ──

import { useSearchParams } from "@solidjs/router";
import { createSignal } from "solid-js";
import { createCardE, deleteCardE, getCardsE, searchCardsE } from "../api.ts";
import type { Card, CreateCardRequest } from "../types.ts";
import type { PaginatedCards } from "../api.ts";
import { getErrorMessage } from "../../../apis/types/index.ts";
import { showToast } from "../../../components/ui/toastStore.ts";

export function useCardsList() {
	const [cards, setCards] = createSignal<Card[]>([]);
	const [page, setPage] = createSignal(1);
	const [totalPages, setTotalPages] = createSignal(0);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<unknown>(null);
	const [showCreateModal, setShowCreateModal] = createSignal(false);
	const [newCardContent, setNewCardContent] = createSignal("");
	const [isCreating, setIsCreating] = createSignal(false);
	const [modalError, setModalError] = createSignal("");
	const [deletingCardId, setDeletingCardId] = createSignal<number | null>(null);

	const [searchParams, setSearchParams] = useSearchParams();
	const searchQuery = () => {
		const q = searchParams.q;
		return typeof q === "string" ? q : "";
	};
	const isSearchMode = () => searchQuery().trim().length > 0;

	const loadCards = async (p = 1) => {
		try {
			setLoading(true);
			const result: PaginatedCards = await getCardsE(p);
			setCards(result.items);
			setPage(result.page);
			setTotalPages(result.total_pages);
		} catch {
			/* ignore */
		} finally {
			setLoading(false);
		}
	};

	const handleCardDelete = async (id: number) => {
		if (!confirm("确定要删除这个卡片吗？此操作不可撤销。")) return;
		if (deletingCardId() === id) return;
		setDeletingCardId(id);
		const current = cards();
		const cardToDelete = current.find((c) => c.id === id);
		if (cardToDelete) setCards(current.filter((c) => c.id !== id));
		try {
			await deleteCardE(id);
			showToast({
				type: "success",
				title: "卡片已删除",
				message: "",
				duration: 3000,
			});
		} catch {
			if (cardToDelete) setCards([...current]);
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
		try {
			const req: CreateCardRequest = { content: newCardContent().trim() };
			const newCard = await createCardE(req);
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
		setPage(1);
		if (!query) {
			await loadCards(1);
			return;
		}
		try {
			setLoading(true);
			const result: PaginatedCards = await searchCardsE(query, 1);
			setCards(result.items);
			setPage(result.page);
			setTotalPages(result.total_pages);
		} catch {
			/* global toast handled */
		} finally {
			setLoading(false);
		}
	};

	const [loadingMore, setLoadingMore] = createSignal(false);
	const [hasMore, setHasMore] = createSignal(true);

	const handlePageChange = async (newPage: number) => {
		if (newPage < 1 || newPage > totalPages()) return;
		setPage(newPage);
		try {
			setLoading(true);
			const q = searchQuery();
			const result: PaginatedCards = q
				? await searchCardsE(q, newPage)
				: await getCardsE(newPage);
			setCards(result.items);
			setPage(result.page);
			setTotalPages(result.total_pages);
		} catch {
			/* ignore */
		} finally {
			setLoading(false);
		}
	};

	const handleLoadMore = async () => {
		if (loadingMore() || !hasMore()) return;
		const nextPage = page() + 1;
		if (totalPages() > 0 && nextPage > totalPages()) {
			setHasMore(false);
			return;
		}
		setLoadingMore(true);
		try {
			const q = searchQuery();
			const result: PaginatedCards = q
				? await searchCardsE(q, nextPage)
				: await getCardsE(nextPage);
			setCards([...cards(), ...result.items]);
			setPage(result.page);
			setTotalPages(result.total_pages);
			if (result.page >= result.total_pages) {
				setHasMore(false);
			}
		} catch {
			/* ignore */
		} finally {
			setLoadingMore(false);
		}
	};

	return {
		cards,
		setCards,
		page,
		setPage,
		totalPages,
		setTotalPages,
		loading,
		setLoading,
		error,
		setError,
		searchQuery,
		isSearchMode,
		showCreateModal,
		setShowCreateModal,
		newCardContent,
		setNewCardContent,
		isCreating,
		modalError,
		deletingCardId,
		loadCards,
		loadingMore,
		hasMore,
		handleCardDelete,
		handleCreateCard,
		handleSearch,
		handlePageChange,
		handleLoadMore,
	};
}
