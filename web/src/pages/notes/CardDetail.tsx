import { useNavigate, useParams } from "@solidjs/router";
import { Effect } from "effect";
import { type Component, createResource, Show } from "solid-js";
import { deleteCard, getCard } from "@/apis/cardApi";
import Markdown from "@/components/Markdown";
import styles from "./CardDetail.module.css"

const CardDetailPage: Component = () => {
	const params = useParams();
	const navigate = useNavigate();
	const cardId = () => {
		const id = params.id;
		if (!id || !/^\d+$/.test(id)) {
			return NaN;
		}
		return parseInt(id, 10);
	};

	const [card, { refetch }] = createResource(async () => {
		const id = cardId();
		if (isNaN(id)) {
			throw new Error("无效的卡片ID");
		}
		try {
			const data = await Effect.runPromise(getCard(id));
			return data;
		} catch (error) {
			console.error("获取卡片详情失败:", error);
			throw error;
		}
	});

	const formatDate = (dateString: string): string => {
		try {
			const date = new Date(dateString);
			return date.toLocaleDateString("zh-CN", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});
		} catch {
			return dateString;
		}
	};

	const handleEdit = () => {
		const id = cardId();
		console.log("编辑卡片:", id);
		// 跳转到编辑页面
		navigate(`/c/edit/${id}`);
	};

	const handleDelete = async () => {
		if (confirm("确定要删除这个卡片吗？此操作不可撤销。")) {
			await Effect.runPromise(
				deleteCard(cardId()).pipe(
					Effect.tap(() => {
						// 删除成功后跳转到卡片列表
						navigate("/c");
					}),
					Effect.catchAll((error) => {
						console.error("删除卡片失败:", error);
						alert("删除卡片失败，请重试");
						return Effect.void;
					}),
				),
			);
		}
	};

	const handleBack = () => {
		navigate("/c");
	};

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<button
					type="button"
					class={styles.backButton}
					onClick={handleBack}
					aria-label="返回"
				>
					← 返回
				</button>
				<div class={styles.actions}>
					<button
						type="button"
						class={styles.editButton}
						onClick={handleEdit}
						disabled={card.loading || card.error}
					>
						编辑
					</button>
					<button
						type="button"
						class={styles.deleteButton}
						onClick={handleDelete}
						disabled={card.loading || card.error}
					>
						删除
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
				{(currentCard) => (
					<div class={styles.cardDetail}>
						<div class={styles.cardMeta}>
							<div class={styles.metaItem}>
								<span class={styles.metaLabel}>创建时间:</span>
								<span class={styles.metaValue}>
									{formatDate(currentCard().created_at)}
								</span>
							</div>
							<div class={styles.metaItem}>
								<span class={styles.metaLabel}>更新时间:</span>
								<span class={styles.metaValue}>
									{formatDate(currentCard().updated_at)}
								</span>
							</div>
						</div>

						<div class={styles.cardContent}>
							<div class={styles.contentBody}>
								<Markdown content={currentCard().content} />
							</div>
						</div>

						<div class={styles.cardActions}>
							<button
								type="button"
								class={styles.editButton}
								onClick={handleEdit}
							>
								编辑卡片
							</button>
							<button
								type="button"
								class={styles.deleteButton}
								onClick={handleDelete}
							>
								删除卡片
							</button>
						</div>
					</div>
				)}
			</Show>
		</div>
	);
};

export default CardDetailPage;
