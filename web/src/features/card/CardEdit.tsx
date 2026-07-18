import { useNavigate, useParams } from "@solidjs/router";
import {
	type Component,
	createEffect,
	createResource,
	createSignal,
	Show,
} from "solid-js";
import { getErrorMessage } from "../../apis/types/index.ts";
import { AsyncView } from "../../components/ui/AsyncView.tsx";
import Breadcrumb from "../../components/ui/Breadcrumb.tsx";
import Button from "../../components/ui/Button.tsx";
import MarkdownEditor from "../../components/ui/MarkdownEditor.tsx";
import Toolbar from "../../components/ui/Toolbar.tsx";
import { showConfirm, tryOrNotify } from "../../lib/safe-action.ts";
import { deleteCardE, getCardE, updateCardE } from "./api.ts";
import styles from "./CardEdit.module.css";
import type { UpdateCardRequest } from "./types.ts";

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
		const confirmed = await showConfirm({
			title: "删除卡片",
			message: "确定要删除这个卡片吗？此操作不可撤销。",
			variant: "danger",
		});
		if (!confirmed) return;
		const ok = await tryOrNotify(() => deleteCardE(cardId()), "删除卡片");
		if (ok) navigate("/c");
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
			<Toolbar
				title="编辑卡片"
				backLabel="返回"
				onBack={() => navigate(`/c/${cardId()}`)}
			>
				<Button variant="danger" size="sm" onClick={handleDelete}>
					删除
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={doSave}
					disabled={isSubmitting()}
				>
					{isSubmitting() ? "保存中..." : "保存"}
				</Button>
			</Toolbar>

			<Show when={error()}>
				<div class={styles.errorMsg}>{error()}</div>
			</Show>

			<AsyncView
				data={card() ? [card()] : []}
				loading={card.loading}
				error={card.error}
				onRetry={refetch}
			>
				{() => (
					<Show when={!card.loading && !card.error}>
						<MarkdownEditor
							value={content()}
							onInput={setContent}
							preview
							rows={20}
							placeholder="输入 Markdown 内容…支持粘贴和拖拽图片"
						/>
					</Show>
				)}
			</AsyncView>
		</div>
	);
};

export default CardEditPage;
