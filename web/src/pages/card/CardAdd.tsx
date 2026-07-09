import { useNavigate } from "@solidjs/router";
import { type Component, createSignal, Show } from "solid-js";
import { createCardE } from "../../apis/cardApi.ts";
import { type CreateCardRequest, getErrorMessage } from "../../apis/types/index.ts";
import Breadcrumb from "../../components/ui/Breadcrumb.tsx";
import MarkdownEditor from "../../components/ui/MarkdownEditor.tsx";
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
		try {
			const req: CreateCardRequest = { content: content().trim() };
			const card = await createCardE(req);
			navigate(`/c/${card.id}`);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			doCreate();
		}
	};

	return (
		<div class={styles.container} onKeyDown={handleKeyDown}>
			<Breadcrumb
				items={[
					{ label: "首页", href: "/" },
					{ label: "卡片", href: "/c" },
					{ label: "新建卡片" },
				]}
			/>
			<div class={styles.toolbar}>
				<button
					type="button"
					class={styles.backBtn}
					onClick={() => navigate("/c")}
				>
					← 卡片列表
				</button>
				<span class={styles.toolbarTitle}>新建卡片</span>
				<div class={styles.toolbarActions}>
					<button
						type="button"
						class={styles.saveBtn}
						onClick={doCreate}
						disabled={isSubmitting() || !canSave()}
					>
						{isSubmitting() ? "保存中..." : "保存"}
					</button>
				</div>
			</div>

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
