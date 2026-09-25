import { fillPath, PATHS } from "@config/paths";
import { getErrorMessage } from "@shared/api";
import { tryAsync } from "@shared/utils";
import { useNavigate } from "@solidjs/router";
import { createSignal } from "solid-js";
import { createCardE } from "../api.ts";
import type { CreateCardRequest } from "../model.ts";

export interface CardAddApi {
	content: () => string;
	setContent: (value: string) => void;
	isSubmitting: () => boolean;
	error: () => string;
	canSave: () => boolean;
	doCreate: () => Promise<void>;
	handleKeyDown: (e: KeyboardEvent) => void;
	handleBack: () => void;
}

export function useCardAdd(): CardAddApi {
	const navigate = useNavigate();

	const [content, setContent] = createSignal("");
	const [isSubmitting, setIsSubmitting] = createSignal(false);
	const [error, setError] = createSignal("");

	const canSave = () => content().trim().length > 0;

	const doCreate = async () => {
		if (!canSave()) {
			setError("内容不能为空");
			return;
		}
		setIsSubmitting(true);
		setError("");
		const result = await tryAsync(async () => {
			const req: CreateCardRequest = { content: content().trim() };
			return await createCardE(req);
		});
		if (result.ok) {
			navigate(fillPath(PATHS.cardDetail, result.value.id));
		} else {
			setError(getErrorMessage(result.error));
		}
		setIsSubmitting(false);
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			doCreate();
		}
	};

	const handleBack = () => {
		navigate(PATHS.card);
	};

	return {
		content,
		setContent,
		isSubmitting,
		error,
		canSave,
		doCreate,
		handleKeyDown,
		handleBack,
	};
}
