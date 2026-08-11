import type { CreateCardRequest } from "@entities/card";
import { createCardE } from "@entities/card";
import { MarkdownEditor } from "@features/markdown-editor";
import styles from "@pages/card/CardAdd.module.css";
import { getErrorMessage } from "@shared/api";
import { tryAsync } from "@shared/lib";
import { Button, Toolbar } from "@shared/ui";
import { useNavigate } from "@solidjs/router";
import { type Component, createSignal, Show } from "solid-js";

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
				onBack={() => navigate("/c")}
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
