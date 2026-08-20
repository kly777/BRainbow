import { fillPath, PATHS } from "@config/paths";
import { getErrorMessage } from "@lib/api";
import { showConfirm, tryAsync, tryOrNotify } from "@lib/utils";
import type { UpdateCardRequest } from "@modules/card";
import { deleteCardE, getCardE, updateCardE } from "@modules/card";
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

	const [card, { refetch }] = createResource(async () => {
		const id = cardId();
		if (Number.isNaN(id)) throw new Error("无效ID");
		return await getCardE(id);
	});

	const [content, setContent] = createSignal("");
	const [isSubmitting, setIsSubmitting] = createSignal(false);
	const [error, setError] = createSignal("");

	createEffect(() => {
		const c = card();
		if (c) setContent(c.content);
	});

	const dirty = () => !!card() && card()!.content !== content();

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
		const confirmed = await showConfirm({
			title: "删除卡片",
			message: "确定要删除这个卡片吗？此操作不可撤销。",
			variant: "danger",
		});
		if (!confirmed) return;
		const ok = await tryOrNotify(() => deleteCardE(cardId()), "删除卡片");
		if (ok) navigate(PATHS.card);
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
		cardLoading: card.loading,
		cardError: card.error,
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
