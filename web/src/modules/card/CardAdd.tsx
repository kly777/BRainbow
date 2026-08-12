import { MarkdownEditor } from "@components";
import { Button, Toolbar } from "@components/ui";
import { getErrorMessage } from "@lib/api";
import { PATHS } from "@lib/config";
import { tryAsync } from "@lib/utils";
import type { CreateCardRequest } from "@modules/card";
import { createCardE } from "@modules/card";
import { useNavigate } from "@solidjs/router";
import { type Component, createSignal, Show } from "solid-js";
import styles from "./CardAdd.module.css";

const CardAddPage: Component = () => {
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
			navigate(`/c/${result.value.id}`);
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

	return (
		<div class={styles.container} onKeyDown={handleKeyDown} role="none">
			<Toolbar
				title="新建卡片"
				backLabel="卡片列表"
				onBack={() => navigate(PATHS.card)}
			>
				<Button
					variant="primary"
					size="sm"
					onClick={doCreate}
					disabled={isSubmitting() || !canSave()}
				>
					{isSubmitting() ? "保存中..." : "保存"}
				</Button>
			</Toolbar>

			<Show when={error()}>
				<div class={styles.errorMsg}>{error()}</div>
			</Show>

			<div class={styles.editorArea}>
				<MarkdownEditor
					value={content()}
					onInput={setContent}
					preview
					rows={20}
					placeholder="输入 Markdown 内容…支持粘贴和拖拽图片"
				/>
			</div>
		</div>
	);
};

export default CardAddPage;
