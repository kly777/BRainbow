import { fillPath, PATHS } from "@config/paths";
import { deleteCardE, getCardE } from "@modules/card";
import { confirmAndDelete, tryAsync } from "@shared/utils";
import { useNavigate, useParams } from "@solidjs/router";
import { createResource, createSignal } from "solid-js";
import type { Card } from "../model.ts";

export interface CardDetailApi {
	cardId: () => number;
	card: () => Card | undefined;
	cardLoading: boolean;
	cardError: unknown;
	refetch: () => void;
	handleDelete: () => Promise<void>;
	handleEdit: () => void;
	handleBack: () => void;
}

export function useCardDetail(): CardDetailApi {
	const params = useParams();
	const navigate = useNavigate();

	const cardId = () => {
		const id = params.id;
		if (!id || !/^\d+$/.test(id)) return NaN;
		return parseInt(id, 10);
	};

	/** 加载失败单独用信号暴露：任其逃逸会让页面既无错误态也无数据 */
	const [loadError, setLoadError] = createSignal<unknown>(null);

	const INVALID_ID_ERROR = new Error("无效ID");
	const validId = () => !Number.isNaN(cardId());

	const [card, { refetch }] = createResource(cardId, async (id) => {
		if (!validId()) {
			setLoadError(INVALID_ID_ERROR);
			return undefined;
		}
		const result = await tryAsync(() => getCardE(id));
		if (result.ok) {
			setLoadError(null);
			return result.value;
		}
		setLoadError(result.error);
		return undefined;
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
		card,
		get cardLoading() {
			return card.loading;
		},
		get cardError() {
			return loadError() ?? undefined;
		},
		refetch,
		handleDelete,
		handleEdit,
		handleBack,
	};
}
