// ── 卡片列表核心业务逻辑 ──

import { useSearchParams } from "@solidjs/router";
import { createSignal } from "solid-js";
import { getErrorMessage } from "../../../apis/types/index.ts";
import { showToast } from "../../../components/ui/toastStore.ts";
import { tryAsync } from "../../../lib/result.ts";
import { showConfirm, tryOrNotify } from "../../../lib/safe-action.ts";
import type { Card, CreateCardRequest } from "../types.ts";
import { createCardE, deleteCardE, getCardsE, searchCardsE } from "../api.ts";

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
		const result = await tryAsync(() => getCardsE(p));
		if (result.ok) {
			setCards(result.value.items);
			setPage(result.value.page);
			setTotalPages(result.value.total_pages);
		}
		// 全局错误处理已 toast，此处仅保留加载状态
	};

	const handleCardDelete = async (id: number) => {
		const confirmed = await showConfirm({
			title: "删除卡片",
			message: "确定要删除这个卡片吗？此操作不可撤销。",
			variant: "danger",
		});
		if (!confirmed) return;
		if (deletingCardId() === id) return;

		setDeletingCardId(id);
		const current = cards();
		const cardToDelete = current.find((c) => c.id === id);
		if (cardToDelete) setCards(current.filter((c) => c.id !== id));

		const ok = await tryOrNotify(() => deleteCardE(id), "删除卡片");
		if (!ok) {
			if (cardToDelete) setCards([...current]);
		} else {
			showToast({
				type: "success",
				title: "卡片已删除",
				message: "",
				duration: 3000,
			});
		}
		setDeletingCardId(null);
	};

	const handleCreateCard = async () => {
		if (!newCardContent().trim()) {
			setError("内容不能为空");
			return;
		}
		setIsCreating(true);
		setModalError("");

		const result = await tryAsync(async () => {
			const req: CreateCardRequest = { content: newCardContent().trim() };
			return await createCardE(req);
		});

		if (result.ok) {
			setNewCardContent("");
			setShowCreateModal(false);
			setCards([result.value, ...cards()]);
			showToast({
				type: "success",
				title: "卡片已创建",
				message: "",
				duration: 3000,
			});
		} else {
			setModalError(getErrorMessage(result.error));
		}
		setIsCreating(false);
	};

	const handleSearch = async (query: string) => {
		setSearchParams({ q: query || undefined });
		setPage(1);
		setHasMore(true);
		if (!query) {
			await loadCards(1);
			return;
		}
		const result = await tryAsync(() => searchCardsE(query, 1));
		if (result.ok) {
			setCards(result.value.items);
			setPage(result.value.page);
			setTotalPages(result.value.total_pages);
		}
		// 全局错误处理已 toast
	};

	const [loadingMore, setLoadingMore] = createSignal(false);
	const [hasMore, setHasMore] = createSignal(true);

	const handlePageChange = async (newPage: number) => {
		if (newPage < 1 || newPage > totalPages()) return;
		setPage(newPage);
		setLoading(true);
		const q = searchQuery();
		const result = await tryAsync(() =>
			q ? searchCardsE(q, newPage) : getCardsE(newPage),
		);
		if (result.ok) {
			setCards(result.value.items);
			setPage(result.value.page);
			setTotalPages(result.value.total_pages);
		}
		// 全局错误处理已 toast
		setLoading(false);
	};

	const handleLoadMore = async () => {
		if (loadingMore() || !hasMore()) return;
		const nextPage = page() + 1;
		if (totalPages() > 0 && nextPage > totalPages()) {
			setHasMore(false);
			return;
		}
		setLoadingMore(true);
		const q = searchQuery();
		const result = await tryAsync(() =>
			q ? searchCardsE(q, nextPage) : getCardsE(nextPage),
		);
		if (result.ok) {
			setCards([...cards(), ...result.value.items]);
			setPage(result.value.page);
			setTotalPages(result.value.total_pages);
			if (result.value.page >= result.value.total_pages) {
				setHasMore(false);
			}
		}
		// 全局错误处理已 toast
		setLoadingMore(false);
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
