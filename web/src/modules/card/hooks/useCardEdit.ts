import { fillPath, PATHS } from "@config/paths";
import { getErrorMessage } from "@shared/api";
import { confirmAndDelete, tryAsync, useDetailResource } from "@shared/utils";
import { useNavigate, useParams } from "@solidjs/router";
import { type Accessor, createEffect, createSignal } from "solid-js";
import { deleteCardE, getCardE, updateCardE } from "../api.ts";
import type { Card, UpdateCardRequest } from "../model.ts";

export interface CardEditApi {
	cardId: () => number;
	card: Accessor<Card | undefined>;
	cardLoading: Accessor<boolean>;
	cardError: Accessor<unknown>;
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

/** 无效 id 时暴露的错误（页面据此显示文案，且不发起请求） */
const INVALID_ID_ERROR = new Error("无效ID");

/**
 * 编辑器页的取数：与 useCardDetail 同源，都走 `useDetailResource`
 * （原先两处各手抄了一份取数 + 错误信号，是同一规则的第二、三份定义）。
 */
export function useCardEdit(): CardEditApi {
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
	const card = m.data;

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
		cardLoading: m.loading,
		cardError: m.error,
		refetch: m.refetch,
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
