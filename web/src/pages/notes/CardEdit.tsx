import { useNavigate, useParams } from "@solidjs/router";
import {
	type Component,
	createEffect,
	createResource,
	createSignal,
	Show,
} from "solid-js";
import { cardApi, type UpdateCardRequest } from "@/apis";
import styles from "@/styles/notes/cardEdit.module.css";

const CardEditPage: Component = () => {
	const params = useParams();
	const navigate = useNavigate();

	const cardId = () => {
		const id = params.id;
		if (!id) {
			throw new Error("卡片ID不能为空");
		}
		return parseInt(id, 10);
	};

	// 加载卡片数据
	const [card, { refetch }] = createResource(async () => {
		try {
			const data = await cardApi.getCard(cardId());
			return data;
		} catch (error) {
			console.error("获取卡片详情失败:", error);
			throw error;
		}
	});

	// 表单状态
	const [title, setTitle] = createSignal("");
	const [content, setContent] = createSignal("");
	const [isSubmitting, setIsSubmitting] = createSignal(false);
	const [error, setError] = createSignal("");

	// 当卡片数据加载完成后，填充表单
	createEffect(() => {
		const currentCard = card();
		if (currentCard) {
			setTitle(currentCard.title);
			setContent(currentCard.content);
		}
	});

	// 处理表单提交
	const handleSubmit = async (e: Event) => {
		e.preventDefault();

		if (!title().trim()) {
			setError("标题不能为空");
			return;
		}

		if (!content().trim()) {
			setError("内容不能为空");
			return;
		}

		setIsSubmitting(true);
		setError("");

		try {
			const request: UpdateCardRequest = {
				title: title().trim(),
				content: content().trim(),
			};

			await cardApi.updateCard(cardId(), request);

			// 编辑成功后跳转到卡片详情页面
			navigate(`/c/${cardId()}`);

			console.log("卡片更新成功");
		} catch (error) {
			console.error("更新卡片失败:", error);
			setError("更新卡片失败，请重试");
		} finally {
			setIsSubmitting(false);
		}
	};

	// 处理取消
	const handleCancel = () => {
		navigate(`/c/${cardId()}`);
	};

	// 处理删除
	const handleDelete = async () => {
		if (confirm("确定要删除这个卡片吗？此操作不可撤销。")) {
			try {
				await cardApi.deleteCard(cardId());
				// 删除成功后跳转到卡片列表
				navigate("/c");
			} catch (error) {
				console.error("删除卡片失败:", error);
				alert("删除卡片失败，请重试");
			}
		}
	};

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<h1 class={styles.title}>编辑卡片</h1>
				<div class={styles.actions}>
					<button
						type="button"
						class={styles.deleteButton}
						onClick={handleDelete}
						disabled={isSubmitting() || card.loading || card.error}
					>
						删除卡片
					</button>
				</div>
			</div>

			<Show when={card.loading}>
				<div class={styles.loading}>
					<p>加载中...</p>
				</div>
			</Show>

			<Show when={card.error}>
				<div class={styles.error}>
					<p>加载失败: {card.error?.toString()}</p>
					<button
						type="button"
						class={styles.retryButton}
						onClick={() => refetch()}
					>
						重试
					</button>
				</div>
			</Show>

			<Show when={!card.loading && !card.error && card()}>
				<form class={styles.form} onSubmit={handleSubmit}>
					<Show when={error()}>
						<div class={styles.errorMessage}>{error()}</div>
					</Show>

					<div class={styles.formGroup}>
						<label for="card-title" class={styles.formLabel}>
							标题 *
						</label>
						<input
							id="card-title"
							type="text"
							class={styles.formInput}
							value={title()}
							onInput={(e) => setTitle(e.currentTarget.value)}
							placeholder="请输入卡片标题"
							disabled={isSubmitting()}
							required
						/>
					</div>

					<div class={styles.formGroup}>
						<label for="card-content" class={styles.formLabel}>
							内容 *
						</label>
						<div class={styles.editorContainer}>
							<textarea
								id="card-content"
								class={styles.editorTextarea}
								value={content()}
								onInput={(e) => setContent(e.currentTarget.value)}
								placeholder="请输入卡片内容（支持Markdown格式）"
								rows={15}
								disabled={isSubmitting()}
								required
							/>
							<div class={styles.editorHelp}>
								<p>支持Markdown语法：</p>
								<ul>
									<li>
										<code># 标题</code> - 一级标题
									</li>
									<li>
										<code>**粗体**</code> - 粗体文本
									</li>
									<li>
										<code>*斜体*</code> - 斜体文本
									</li>
									<li>
										<code>- 列表项</code> - 无序列表
									</li>
									<li>
										<code>1. 列表项</code> - 有序列表
									</li>
									<li>
										<code>`代码`</code> - 行内代码
									</li>
									<li>
										<code>```代码块```</code> - 代码块
									</li>
									<li>
										<code>[链接](url)</code> - 超链接
									</li>
									<li>
										<code>![图片](url)</code> - 图片
									</li>
								</ul>
							</div>
						</div>
					</div>

					<div class={styles.formActions}>
						<button
							type="button"
							class={styles.cancelButton}
							onClick={handleCancel}
							disabled={isSubmitting()}
						>
							取消
						</button>
						<button
							type="submit"
							class={styles.submitButton}
							disabled={isSubmitting()}
						>
							{isSubmitting() ? "保存中..." : "保存更改"}
						</button>
					</div>
				</form>
			</Show>
		</div>
	);
};

export default CardEditPage;
