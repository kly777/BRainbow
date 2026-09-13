import { fillPath, PATHS } from "@config/paths";
import { deleteCardE, getCardE } from "@modules/card";
import { confirmAndDelete } from "@shared/utils";
import { useNavigate, useParams } from "@solidjs/router";
import { createResource } from "solid-js";
import type { Card } from "../model.ts";

export interface CardDetailApi {
	cardId: () => number;
	card: () => Card | undefined;
	cardLoading: boolean;
	cardError: Error | undefined;
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

	const INVALID_ID_ERROR = new Error("无效ID");
	const validId = () => !Number.isNaN(cardId());

	const [card, { refetch }] = createResource(cardId, async (id) => {
		// 不抛错：fetcher 抛错会中断响应式更新，AsyncView 会一直显示骨架屏
		if (!validId()) return undefined;
		return await getCardE(id);
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
			if (card.error) return card.error;
			return validId() ? undefined : INVALID_ID_ERROR;
		},
		refetch,
		handleDelete,
		handleEdit,
		handleBack,
	};
}
