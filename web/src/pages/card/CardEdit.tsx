import { useNavigate, useParams } from "@solidjs/router";
import {
	type Component,
	createEffect,
	createResource,
	createSignal,
	Show,
} from "solid-js";
import { deleteCardE, getCardE, updateCardE } from "../../apis/cardApi.ts";
import type { UpdateCardRequest } from "../../apis/types/index.ts";
import { getErrorMessage } from "../../apis/types/index.ts";
import Breadcrumb from "../../components/ui/Breadcrumb.tsx";
import MarkdownEditor from "../../components/ui/MarkdownEditor.tsx";
import { AsyncView } from "../../components/ui/AsyncView.tsx";
import styles from "./CardEdit.module.css";

const CardEditPage: Component = () => {
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

	const doSave = async () => {
		if (!content().trim()) {
			setError("内容不能为空");
			return;
		}
		setIsSubmitting(true);
		setError("");
		try {
			const req: UpdateCardRequest = { content: content().trim() };
			await updateCardE(cardId(), req);
			navigate(`/c/${cardId()}`);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleDelete = async () => {
		if (!confirm("确定要删除？")) return;
		try {
			await deleteCardE(cardId());
			navigate("/c");
		} catch {
			/* ignore */
		}
	};

	return (
		<div class={styles.container}>
			<Breadcrumb
				items={[
					{ label: "首页", href: "/" },
					{ label: "卡片", href: "/c" },
					{ label: `#${cardId()}`, href: `/c/${cardId()}` },
					{ label: "编辑" },
				]}
			/>
			<div class={styles.toolbar}>
				<button
					type="button"
					class={styles.backBtn}
					onClick={() => navigate(`/c/${cardId()}`)}
				>
					← 返回
				</button>
				<span class={styles.toolbarTitle}>编辑卡片</span>
				<div class={styles.toolbarActions}>
					<button type="button" class={styles.deleteBtn} onClick={handleDelete}>
						删除
					</button>
					<button
						type="button"
						class={styles.saveBtn}
						onClick={doSave}
						disabled={isSubmitting()}
					>
						{isSubmitting() ? "保存中..." : "保存"}
					</button>
				</div>
			</div>

			<AsyncView
				data={card() ? [card()] : []}
				loading={card.loading}
				error={card.error}
				onRetry={refetch}
			>
				{() => (
					<Show when={!card.loading && !card.error}>
						<Show when={error()}>
							<div class={styles.errorMsg}>{error()}</div>
						</Show>
						<MarkdownEditor
							value={content()}
							onInput={setContent}
							preview
							rows={20}
							placeholder="输入 Markdown 内容...支持粘贴和拖拽图片"
						/>
					</Show>
				)}
			</AsyncView>
		</div>
	);
};

export default CardEditPage;
