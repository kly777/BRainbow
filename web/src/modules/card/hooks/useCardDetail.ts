import { fillPath, PATHS } from "@config/paths";
import { confirmAndDelete, useDetailResource } from "@shared/utils";
import { useNavigate, useParams } from "@solidjs/router";
import type { Accessor } from "solid-js";
import { deleteCardE, getCardE } from "../api.ts";
import type { Card } from "../model.ts";

export interface CardDetailApi {
	cardId: () => number;
	card: Accessor<Card | undefined>;
	cardLoading: Accessor<boolean>;
	cardError: Accessor<unknown>;
	refetch: () => void;
	handleDelete: () => Promise<void>;
	handleEdit: () => void;
	handleBack: () => void;
}

/** 无效 id 时暴露的错误（页面据此显示文案，且不发起请求） */
const INVALID_ID_ERROR = new Error("无效ID");

/**
 * 取数走共享的 `useDetailResource`：错误消化、无效 id 判定、"首次加载 vs 后台刷新"
 * 的区分都在原语里 —— 这里原先手抄了一份同样的实现（含自己维护的 loadError 信号），
 * 那是这套规则的第二处定义，改一处漏一处。
 */
export function useCardDetail(): CardDetailApi {
	const params = useParams();
	const navigate = useNavigate();

	const cardId = () => {
		const id = params.id;
		if (!id || !/^\d+$/.test(id)) return NaN;
		return parseInt(id, 10);
	};

	const m = useDetailResource({
		id: cardId,
		validate: (id) => Number.isInteger(id) && id >= 1,
		invalidIdError: INVALID_ID_ERROR,
		fetcher: (id) => getCardE(id),
	});

	const handleDelete = async () => {
		await confirmAndDelete({
			title: "删除卡片",
			message: "确定要删除这个卡片吗？此操作不可撤销。",
			deleteFn: () => deleteCardE(cardId()),
			onSuccess: () => navigate(PATHS.card),
		});
	};

	const handleEdit = () => {
		navigate(fillPath(PATHS.cardEdit, cardId()));
	};

	const handleBack = () => {
		navigate(PATHS.card);
	};

	return {
		cardId,
		card: m.data,
		cardLoading: m.loading,
		cardError: m.error,
		refetch: m.refetch,
		handleDelete,
		handleEdit,
		handleBack,
	};
}
