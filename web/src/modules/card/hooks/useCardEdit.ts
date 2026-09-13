import { fillPath, PATHS } from "@config/paths";
import type { UpdateCardRequest } from "@modules/card";
import { deleteCardE, getCardE, updateCardE } from "@modules/card";
import { getErrorMessage } from "@shared/api";
import { confirmAndDelete, tryAsync } from "@shared/utils";
import { useNavigate, useParams } from "@solidjs/router";
import { createEffect, createResource, createSignal } from "solid-js";
import type { Card } from "../model.ts";

export interface CardEditApi {
	cardId: () => number;
	card: () => Card | undefined;
	cardLoading: boolean;
	cardError: Error | undefined;
	refetch: () => void;
	content: () => string;
	setContent: (value: string) => void;
	isSubmitting: () => boolean;
	error: () => string;
	dirty: () => boolean;
	stampLabel: () => string;
	stamp: () => string;
	doSave: () => Promise<void>;
	handleDelete: () => Promise<void>;
	handleView: () => void;
	onKeyDown: (e: KeyboardEvent) => void;
}

export function useCardEdit(): CardEditApi {
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

	const [content, setContent] = createSignal("");
	const [isSubmitting, setIsSubmitting] = createSignal(false);
	const [error, setError] = createSignal("");

	createEffect(() => {
		const c = card();
		if (c) setContent(c.content);
	});

	const dirty = () => !!card() && card()?.content !== content();

	const stampLabel = () => {
		const c = card();
		if (!c) return "";
		return c.created_at === c.updated_at ? "创建于" : "修改于";
	};

	const stamp = () => {
		const c = card();
		if (!c) return "";
		return c.created_at === c.updated_at ? c.created_at : c.updated_at;
	};

	const doSave = async () => {
		if (!content().trim()) {
			setError("内容不能为空");
			return;
		}
		setIsSubmitting(true);
		setError("");
		const result = await tryAsync(async () => {
			const req: UpdateCardRequest = { content: content().trim() };
			await updateCardE(cardId(), req);
		});
		if (result.ok) {
			navigate(fillPath(PATHS.cardDetail, cardId()));
		} else {
			setError(getErrorMessage(result.error));
		}
		setIsSubmitting(false);
	};

	const handleDelete = async () => {
		await confirmAndDelete({
			title: "删除卡片",
			message: "确定要删除这个卡片吗？此操作不可撤销。",
			deleteFn: () => deleteCardE(cardId()),
			onSuccess: () => navigate(PATHS.card),
		});
	};

	const handleView = () => {
		navigate(fillPath(PATHS.cardDetail, cardId()));
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey) {
			if (e.key === "Enter" || e.key === "s" || e.key === "S") {
				e.preventDefault();
				if (!isSubmitting()) void doSave();
			}
		}
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
		content,
		setContent,
		isSubmitting,
		error,
		dirty,
		stampLabel,
		stamp,
		doSave,
		handleDelete,
		handleView,
		onKeyDown,
	};
}
