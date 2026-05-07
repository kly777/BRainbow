import { type Component, Show } from "solid-js";
import styles from "./Card.module.css";
import Markdown from "./Markdown.tsx";

// 卡片接口，匹配后端API
export interface CardData {
	id: number;
	content: string;
	created_at: string;
	updated_at: string;
}

export interface CardProps extends CardData {
	category?: string;
	tags?: string[];
	maxContentLines?: number;
	onClick?: (id: number) => void;
	onEdit?: (id: number) => void;
	onDelete?: (id: number) => void;
	isDeleting?: boolean;
}

const Card: Component<CardProps> = (props) => {
	const formatDate = (dateString: string): string => {
		try {
			const date = new Date(dateString);
			return date.toLocaleDateString("zh-CN", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch {
			return dateString;
		}
	};

	const handleEditClick = (e: MouseEvent) => {
		e.stopPropagation();
		if (props.onEdit) {
			props.onEdit(props.id);
		}
	};

	const handleDeleteClick = (e: MouseEvent) => {
		e.stopPropagation();
		if (props.onDelete) {
			props.onDelete(props.id);
		}
	};

	const handleTagClick = (e: MouseEvent, tag: string) => {
		e.stopPropagation();
		// 这里可以添加标签点击处理逻辑，比如过滤或搜索
		console.log(`Tag clicked: ${tag}`);
	};

	return (
		<div class={`${styles.card} ${props.isDeleting ? styles.deleting : ""}`}>
			<div class={styles.cardContent}>
				<Markdown content={props.content} />
			</div>

			<Show when={props.tags && props.tags.length > 0}>
				<div class={styles.cardTags}>
					{props.tags?.map((tag) => (
						<button
							type="button"
							class={styles.tag}
							onClick={(e) => handleTagClick(e, tag)}
						>
							{tag}
						</button>
					))}
				</div>
			</Show>

			<div class={styles.cardMeta}>
				<div class={styles.metaItem}>
					<span class={styles.metaLabel}>创建:</span>
					<span class={styles.metaValue}>{formatDate(props.created_at)}</span>
				</div>
				<div class={styles.metaItem}>
					<span class={styles.metaLabel}>更新:</span>
					<span class={styles.metaValue}>{formatDate(props.updated_at)}</span>
				</div>
			</div>

			<div class={styles.cardActions}>
				<button
					type="button"
					class={styles.actionButton}
					onClick={handleEditClick}
				>
					编辑
				</button>
				<button
					type="button"
					class={`${styles.actionButton} ${styles.deleteButton}`}
					onClick={handleDeleteClick}
				>
					删除
				</button>
			</div>
		</div>
	);
};

export default Card;
