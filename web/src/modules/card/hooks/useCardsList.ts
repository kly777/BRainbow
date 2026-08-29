// ── 卡片列表核心业务逻辑 ──

import type { Card, CreateCardRequest } from "@modules/card";
import {
	createCardE,
	deleteCardE,
	getCardsE,
	searchCardsE,
} from "@modules/card";
import { getErrorMessage } from "@shared/api";
import {
	notifyError,
	notifySuccess,
	parseUtc,
	showConfirm,
	strParam,
	tryAsync,
	useModal,
	useUrlParams,
} from "@shared/utils";
import { createMemo, createSignal } from "solid-js";

export function useCardsList() {
	const [cards, setCards] = createSignal<Card[]>([]);
	const [page, setPage] = createSignal(1);
	const [totalPages, setTotalPages] = createSignal(0);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<unknown>(null);
	const createModal = useModal();
	const [newCardContent, setNewCardContent] = createSignal("");
	const [isCreating, setIsCreating] = createSignal(false);
	const [modalError, setModalError] = createSignal("");
	const [deletingCardId, setDeletingCardId] = createSignal<number | null>(null);

	// 排序状态：过滤栏与列表共用此单一来源
	const [sortBy, setSortBy] = createSignal<"created" | "updated">("updated");
	const [sortOrder, setSortOrder] = createSignal<"asc" | "desc">("desc");
	const handleSortChange = (
		by: "created" | "updated",
		order: "asc" | "desc",
	) => {
		setSortBy(by);
		setSortOrder(order);
	};

	/** 排序后的卡片：视图层直接消费 */
	const sortedCards = createMemo(() => {
		const list = [...cards()];
		const sb = sortBy();
		const so = sortOrder();
		list.sort((a, b) => {
			const av =
				sb === "created"
					? parseUtc(a.created_at).getTime()
					: parseUtc(a.updated_at).getTime();
			const bv =
				sb === "created"
					? parseUtc(b.created_at).getTime()
					: parseUtc(b.updated_at).getTime();
			return so === "asc" ? av - bv : bv - av;
		});
		return list;
	});

	const params = useUrlParams({ q: strParam("") });
	// 本地搜索信号：驱动搜索请求，不触发路由重渲染
	const [searchQuery, setSearchQuery] = createSignal(params.get("q"));
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

		// 注意：deleteCardE 返回 void，tryOrNotify 成功时也是 undefined，
		// 用它做成败判据会把成功当失败（回滚已删卡片）。改用 tryAsync 显式分支。
		const result = await tryAsync(() => deleteCardE(id));
		if (result.ok) {
			notifySuccess("卡片已删除");
		} else {
			if (cardToDelete) setCards([...current]);
			notifyError("删除卡片失败", result.error);
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
			createModal.close();
			setCards([result.value, ...cards()]);
			notifySuccess("卡片已创建");
		} else {
			setModalError(getErrorMessage(result.error));
		}
		setIsCreating(false);
	};

	const handleSearch = async (query: string) => {
		// 本地信号驱动搜索；URL 仅在清空时回写（保持 ?q= 深链接语义）。
		// 注：AsyncView 已改为 accessor seam，数据刷新不再重建子树，
		// 此处的本地信号只是搜索状态的归属选择，不再是焦点规避手段。
		setSearchQuery(query);
		setPage(1);
		setHasMore(true);
		if (!query) {
			// 清空搜索时同步 URL（支持深链接）
			params.set({ q: "" });
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
		sortedCards,
		sortBy,
		sortOrder,
		handleSortChange,
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
		showCreateModal: createModal.isOpen,
		setShowCreateModal: (v: boolean) =>
			v ? createModal.open() : createModal.close(),
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
