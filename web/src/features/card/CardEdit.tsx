import { useNavigate, useParams } from "@solidjs/router";
import {
	type Component,
	createEffect,
	createResource,
	createSignal,
	Show,
} from "solid-js";
import { getErrorMessage } from "@apis/types/index.ts";
import { AsyncView } from "@ui/molecules/AsyncView";
import Button from "@ui/atoms/Button";
import MarkdownEditor from "@ui/molecules/MarkdownEditor";
import MarkdownRenderer from "@ui/atoms/Markdown";
import { showConfirm, tryOrNotify } from "@lib/safe-action.ts";
import { tryAsync } from "@lib/result.ts";
import { deleteCardE, getCardE, updateCardE } from "@features/card/api.ts";
import styles from "@features/card/CardEdit.module.css";
import type { UpdateCardRequest } from "@features/card/types.ts";

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

	// 是否有未保存修改
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

	const formatDate = (s: string) => {
		if (!s) return "";
		try {
			return new Date(s).toLocaleString("zh-CN", {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch {
			return s;
		}
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
			navigate(`/c/${cardId()}`);
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
		if (ok) navigate("/c");
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey) {
			if (e.key === "Enter" || e.key === "s" || e.key === "S") {
				e.preventDefault();
				if (!isSubmitting()) void doSave();
			}
		}
	};

	return (
		<div class={styles.container}>
			<header class={styles.header}>
				<div class={styles.titleRow}>
					<h1 class={styles.title}>
						编辑卡片 <span class={styles.cardNo}>#{cardId()}</span>
					</h1>
					<div class={styles.actions}>
						<Button variant="danger" size="sm" onClick={handleDelete}>
							删除
						</Button>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => navigate(`/c/${cardId()}`)}
						>
							查看
						</Button>
						<Button
							variant="primary"
							size="sm"
							onClick={doSave}
							disabled={isSubmitting() || !dirty()}
						>
							{isSubmitting() ? "保存中…" : "保存"}
						</Button>
					</div>
				</div>
				<div class={styles.metaRow}>
					<span class={styles.meta}>
						{stampLabel()} {formatDate(stamp())}
					</span>
					<Show when={dirty()}>
						<span class={styles.dirty}>
							<span class={styles.dirtyDot} />
							未保存
						</span>
					</Show>
				</div>
			</header>

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
						<div class={styles.workspace} onKeyDown={onKeyDown} role="none">
							<div class={styles.panes}>
								<section class={styles.pane}>
									<div class={styles.paneHead}>
										编辑
										<span class={styles.paneHint}>
											Markdown · 粘贴/拖拽图片自动上传
										</span>
									</div>
									<MarkdownEditor
										editorClass={styles.editor}
										class={styles.textarea}
										value={content()}
										onInput={setContent}
										rows={8}
										placeholder="输入 Markdown 内容…"
									/>
								</section>

								<div class={styles.fold} />

								<section class={styles.pane}>
									<div class={styles.paneHead}>实时预览</div>
									<div class={styles.preview}>
										<Show
											when={content().trim()}
											fallback={
												<div class={styles.previewEmpty}>
													开始输入，此处实时渲染 Markdown…
												</div>
											}
										>
											<MarkdownRenderer content={content()} />
										</Show>
									</div>
								</section>
							</div>

							<footer class={styles.statusbar}>
								<span>{content().length} 字</span>
								<span class={styles.shortcut}>
									<kbd>Ctrl</kbd> + <kbd>Enter</kbd> 保存
								</span>
							</footer>
						</div>
					</Show>
				)}
			</AsyncView>
		</div>
	);
};

export default CardEditPage;
