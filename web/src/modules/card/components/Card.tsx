import { Markdown as MarkdownRenderer, Tooltip } from "@components/ui";
import { fmtFull } from "@lib/utils";
import { type Component, Show } from "solid-js";
import styles from "./Card.module.css";

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

	return (
		<div
			classList={{ [styles.card]: true, [styles.deleting]: props.isDeleting }}
		>
			<div class={styles.cardContent}>
				<MarkdownRenderer content={props.content} />
			</div>

			<Show when={props.tags && props.tags.length > 0}>
				<div class={styles.cardTags}>
					{props.tags?.map((tag) => (
						<button
							type="button"
							class={styles.tag}
							onClick={(e) => e.stopPropagation()}
						>
							{tag}
						</button>
					))}
				</div>
			</Show>

			<div class={styles.cardMeta}>
				<div class={styles.metaItem}>
					<span class={styles.metaLabel}>
						{props.created_at === props.updated_at ? "创建于" : "修改于"}:
					</span>
					<span class={styles.metaValue}>
						{fmtFull(
							props.created_at === props.updated_at
								? props.created_at
								: props.updated_at,
						)}
					</span>
				</div>
			</div>

			<div class={styles.cardFabs}>
				<Tooltip label="打开">
					<button
						type="button"
						class={styles.cardFab}
						aria-label="打开"
						onClick={(e) => {
							e.stopPropagation();
							props.onClick?.(props.id);
						}}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M7 17 17 7" />
							<path d="M8 7h9v9" />
						</svg>
					</button>
				</Tooltip>
				<Tooltip label="编辑">
					<button
						type="button"
						class={styles.cardFab}
						aria-label="编辑"
						onClick={handleEditClick}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M12 20h9" />
							<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
						</svg>
					</button>
				</Tooltip>
				<Tooltip label="删除">
					<button
						type="button"
						classList={{ [styles.cardFab]: true, [styles.cardFabDanger]: true }}
						aria-label="删除"
						onClick={handleDeleteClick}
						disabled={props.isDeleting}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M3 6h18" />
							<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
							<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
						</svg>
					</button>
				</Tooltip>
			</div>
		</div>
	);
};

export default Card;
