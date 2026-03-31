import { type Component, Show } from "solid-js";
import styles from "@/styles/components/card.module.css";

// 卡片接口，匹配后端API
export interface CardData {
	id: number;
	title: string;
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

	const getContentPreview = (content: string, maxLines: number = 3): string => {
		// 按换行符分割内容
		const lines = content.split("\n").filter((line) => line.trim() !== "");

		// 如果内容行数少于最大行数，返回全部内容
		if (lines.length <= maxLines) {
			return content;
		}

		// 截取前几行并添加省略号
		const previewLines = lines.slice(0, maxLines);
		return `${previewLines.join("\n")}...`;
	};

	const handleCardClick = () => {
		if (props.onClick) {
			props.onClick(props.id);
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
		<button class={styles.card} onClick={handleCardClick} type="button">
			<div class={styles.cardHeader}>
				<h3 class={styles.cardTitle}>{props.title}</h3>
				<Show when={props.category}>
					<span class={styles.cardCategory}>{props.category}</span>
				</Show>
			</div>

			<div class={styles.cardContent}>
				<p class={styles.cardPreview}>
					{getContentPreview(props.content, props.maxContentLines)}
				</p>
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
		</button>
	);
};

export default Card;
