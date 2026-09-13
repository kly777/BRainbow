// ── 卡片列表核心业务逻辑 ──
//
// 数据源统一走 useListResource（createResource 范式），不再手写
// page/totalPages/loading/error 信号与 fetch —— 改造前本文件与页面各自
// 手写了一遍取数逻辑，是"同一件事多种写法"的典型。

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
	useListResource,
	useModal,
	useUrlParams,
} from "@shared/utils";
import { createMemo, createSignal } from "solid-js";

export function useCardsList() {
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

	const params = useUrlParams({ q: strParam("") });
	// 本地搜索信号：驱动搜索请求，不触发路由重渲染
	const [searchQuery, setSearchQuery] = createSignal(params.get("q"));
	const isSearchMode = () => searchQuery().trim().length > 0;

	const [page, setPage] = createSignal(1);
	const list = useListResource<{ q: string }, Card>({
		key: () => ({ q: searchQuery().trim() }),
		page,
		fetcher: (key, p) => (key.q ? searchCardsE(key.q, p) : getCardsE(p)),
	});

	/** 排序后的卡片：视图层直接消费 */
	const sortedCards = createMemo(() => {
		const arr = [...list.items()];
		const sb = sortBy();
		const so = sortOrder();
		arr.sort((a, b) => {
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
		return arr;
	});

	const handleCardDelete = async (id: number) => {
		const confirmed = await showConfirm({
			title: "删除卡片",
			message: "确定要删除这个卡片吗？此操作不可撤销。",
			variant: "danger",
		});
		if (!confirmed) return;
		if (deletingCardId() === id) return;

		setDeletingCardId(id);
		// 乐观删除：失败时由 useListResource 回滚到操作前快照。
		// 注意 deleteCardE 返回 void，用 tryOrNotify 做成败判据会把成功当失败
		// （从而回滚已删卡片），故用乐观更新的显式结果分支。
		const result = await list.optimistic(
			(items) => items.filter((c) => c.id !== id),
			() => deleteCardE(id),
		);
		if (result.ok) notifySuccess("卡片已删除");
		else notifyError("删除卡片失败", result.error);
		setDeletingCardId(null);
	};

	const handleCreateCard = async () => {
		if (!newCardContent().trim()) {
			// 表单校验失败只标在弹窗里，不能写列表的 error —— 那会让整个列表
			// 变成"加载失败"态（改造前这里就是 setError，属误用）
			setModalError("内容不能为空");
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
			list.patch((items) => [result.value, ...items]);
			notifySuccess("卡片已创建");
		} else {
			setModalError(getErrorMessage(result.error));
		}
		setIsCreating(false);
	};

	const handleSearch = (query: string) => {
		// 本地信号驱动搜索；URL 仅在清空时回写（保持 ?q= 深链接语义）。
		setSearchQuery(query);
		setPage(1);
		setHasMore(true);
		if (!query.trim()) params.set({ q: "" });
	};

	const [loadingMore, setLoadingMore] = createSignal(false);
	const [hasMore, setHasMore] = createSignal(true);

	const handlePageChange = (newPage: number) => {
		if (newPage < 1 || newPage > list.totalPages()) return;
		setPage(newPage);
	};

	/** 追加下一页（无限滚动）；与翻页共用同一数据源 */
	const handleLoadMore = async () => {
		if (loadingMore() || !hasMore()) return;
		const nextPage = page() + 1;
		if (list.totalPages() > 0 && nextPage > list.totalPages()) {
			setHasMore(false);
			return;
		}
		setLoadingMore(true);
		const q = searchQuery().trim();
		const result = await tryAsync(() =>
			q ? searchCardsE(q, nextPage) : getCardsE(nextPage),
		);
		if (result.ok) {
			const res = result.value;
			list.patch((items) => [...items, ...res.items]);
			setPage(res.page);
			if (res.page >= res.total_pages) setHasMore(false);
		}
		setLoadingMore(false);
	};

	return {
		/** 原始顺序（服务端返回顺序）；排序视图用 sortedCards */
		cards: list.items,
		/** 乐观改写本地列表；失败回滚交给 list.optimistic */
		patch: list.patch,
		sortedCards,
		sortBy,
		sortOrder,
		handleSortChange,
		page,
		totalPages: list.totalPages,
		// 必须包成函数：直接写 `error: list.error` 会在构造返回对象时把 getter
		// 求值一次并冻结成 null —— 与 useListResource 注释里警告的快照冻结同类
		loading: () => list.loading,
		error: () => list.error,
		refetch: list.refetch,
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
		loadingMore,
		hasMore,
		handleCardDelete,
		handleCreateCard,
		handleSearch,
		handlePageChange,
		handleLoadMore,
	};
}
