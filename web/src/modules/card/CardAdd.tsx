import { MarkdownEditor } from "@components";
import { Button, DetailPage } from "@components/ui";
import { type Component, Show } from "solid-js";
import styles from "./CardAdd.module.css";
import { useCardAdd } from "./hooks/useCardAdd.ts";

const CardAddPage: Component = () => {
	const m = useCardAdd();

	return (
		<div class={styles.container} onKeyDown={m.handleKeyDown} role="none">
			<DetailPage
				title="新建卡片"
				titleHidden
				backLabel="卡片列表"
				onBack={m.handleBack}
				actions={
					<Button
						variant="primary"
						size="sm"
						onClick={m.doCreate}
						disabled={m.isSubmitting() || !m.canSave()}
					>
						{m.isSubmitting() ? "保存中..." : "保存"}
					</Button>
				}
			>
				<Show when={m.error()}>
					<div class={styles.errorMsg}>{m.error()}</div>
				</Show>

				<div class={styles.editorArea}>
					<MarkdownEditor
						value={m.content()}
						onInput={m.setContent}
						preview
						rows={20}
						placeholder="输入 Markdown 内容…支持粘贴和拖拽图片"
					/>
				</div>
			</DetailPage>
		</div>
	);
};

export default CardAddPage;
