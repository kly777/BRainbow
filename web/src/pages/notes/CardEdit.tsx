import { useNavigate, useParams } from "@solidjs/router";
import { Effect } from "effect";
import {
	type Component,
	createEffect,
	createResource,
	createSignal,
	Show,
} from "solid-js";
import { deleteCard, getCard, updateCard, uploadImage } from "@/apis/cardApi";
import type { UpdateCardRequest } from "@/apis/types";
import { getErrorMessage } from "@/apis/types";
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
	const [isUploading, setIsUploading] = createSignal(false);
	let fileInputRef: HTMLInputElement | undefined;
	let textareaRef: HTMLTextAreaElement | undefined;

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
		} catch (err) {
			setError(getErrorMessage(err));
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
				Effect.catchAll((err) => {
					console.error("删除卡片失败:", getErrorMessage(err));
					return Effect.void;
				}),
			),
		);
	};

	// ── 图片上传 ──
	const triggerUpload = () => {
		fileInputRef?.click();
	};

	const handleFileSelected = async (e: Event) => {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		// 校验类型
		if (!file.type.startsWith("image/")) {
			setError("仅支持图片格式");
			input.value = "";
			return;
		}

		setIsUploading(true);
		setError("");
		try {
			const image = await Effect.runPromise(uploadImage(file));
			const md = `![${image.original_name}](${image.url})`;
			insertAtCursor(md);
		} catch (err) {
			setError(`上传失败: ${getErrorMessage(err)}`);
		} finally {
			setIsUploading(false);
			input.value = "";
		}
	};

	const handlePaste = (e: ClipboardEvent) => {
		const items = e.clipboardData?.items;
		if (!items) return;

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.type.startsWith("image/")) {
				e.preventDefault();
				const file = item.getAsFile();
				if (!file) continue;

				setIsUploading(true);
				setError("");
				Effect.runPromise(uploadImage(file))
					.then((image) => {
						const md = `![${image.original_name}](${image.url})`;
						insertAtCursor(md);
					})
					.catch((err) => {
						setError(`上传失败: ${getErrorMessage(err)}`);
					})
					.finally(() => setIsUploading(false));
				break;
			}
		}
	};

	const insertAtCursor = (text: string) => {
		const ta = textareaRef;
		if (!ta) {
			setContent(content() + text);
			return;
		}
		const start = ta.selectionStart;
		const end = ta.selectionEnd;
		const before = content().slice(0, start);
		const after = content().slice(end);
		const newContent = before + text + after;
		setContent(newContent);
		// 恢复光标位置
		requestAnimationFrame(() => {
			ta.focus();
			ta.setSelectionRange(start + text.length, start + text.length);
		});
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
					<button
						type="button"
						class={styles.uploadBtn}
						onClick={triggerUpload}
						disabled={isUploading()}
					>
						{isUploading() ? "上传中..." : "📷 图片"}
					</button>
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
					加载失败: {getErrorMessage(card.error)}{" "}
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
						ref={textareaRef}
						value={content()}
						onInput={(e) => setContent(e.currentTarget.value)}
						onKeyDown={handleKeyDown}
						onPaste={handlePaste}
						placeholder="输入 Markdown 内容...支持粘贴图片"
						disabled={isSubmitting() || isUploading()}
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
			<input
				type="file"
				ref={fileInputRef}
				class={styles.hiddenInput}
				accept="image/*"
				onChange={handleFileSelected}
			/>
		</div>
	);
};

export default CardEditPage;
