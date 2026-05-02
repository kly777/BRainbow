import { useNavigate, useParams } from "@solidjs/router";
import { Effect } from "effect";
import {
	type Component,
	createEffect,
	createResource,
	createSignal,
	Show,
} from "solid-js";
import { deleteCard, getCard, updateCard } from "@/apis/cardApi";
import type { UpdateCardRequest } from "@/apis/types";
import Markdown from "@/components/Markdown";
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
		return await Effect.runPromise(getCard(id));
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
			await Effect.runPromise(updateCard(cardId(), req));
			navigate(`/c/${cardId()}`);
		} catch {
			setError("更新失败，请重试");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key === "s") {
			e.preventDefault();
			doSave();
		}
	};

	const handleDelete = async () => {
		if (!confirm("确定要删除？")) return;
		await Effect.runPromise(
			deleteCard(cardId()).pipe(
				Effect.tap(() => navigate("/c")),
				Effect.catchAll(() => Effect.void),
			),
		);
	};

	return (
		<div class={styles.container}>
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

			<Show when={card.loading}>
				<div class={styles.loading}>加载中...</div>
			</Show>
			<Show when={card.error}>
				<div class={styles.loading}>
					加载失败{" "}
					<button
						type="button"
						class={styles.retryBtn}
						onClick={() => refetch()}
					>
						重试
					</button>
				</div>
			</Show>

			<Show when={!card.loading && !card.error}>
				<Show when={error()}>
					<div class={styles.errorMsg}>{error()}</div>
				</Show>
				<div class={styles.editor}>
					<textarea
						class={styles.textarea}
						value={content()}
						onInput={(e) => setContent(e.currentTarget.value)}
						onKeyDown={handleKeyDown}
						placeholder="输入 Markdown 内容..."
						disabled={isSubmitting()}
					/>
					<div class={styles.preview}>
						<Show when={content().trim()}>
							<Markdown content={content()} />
						</Show>
						<Show when={!content().trim()}>
							<div class={styles.emptyPreview}>实时预览</div>
						</Show>
					</div>
				</div>
			</Show>
		</div>
	);
};

export default CardEditPage;
