import { Markdown as MarkdownRenderer, Tooltip } from "@components/ui";
import { fmtFull } from "@shared/utils";
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

const CardFabButton: Component<{
	label: string;
	onClick: (e: MouseEvent) => void;
	paths: string[];
	danger?: boolean;
	disabled?: boolean;
}> = (props) => (
	<Tooltip label={props.label}>
		<button
			type="button"
			classList={{
				[styles.cardFab]: true,
				[styles.cardFabDanger]: !!props.danger,
			}}
			aria-label={props.label}
			onClick={props.onClick}
			disabled={props.disabled}
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
				{props.paths.map((d) => (
					<path d={d} />
				))}
			</svg>
		</button>
	</Tooltip>
);

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
			// e2e 用它数"列表里到底渲染了几张卡"：类名是 CSS Modules 的哈希，
			// dev 与构建产物不一致，只有 data-testid 是跨环境稳定的锚点
			data-testid="card"
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
						{props.created_at === props.updated_at ? "创建于" : "修改于"}：
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
				<CardFabButton
					label="打开"
					paths={["M7 17 17 7", "M8 7h9v9"]}
					onClick={(e) => {
						e.stopPropagation();
						props.onClick?.(props.id);
					}}
				/>
				<CardFabButton
					label="编辑"
					paths={["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"]}
					onClick={handleEditClick}
				/>
				<CardFabButton
					label="删除"
					paths={[
						"M3 6h18",
						"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
						"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
					]}
					danger
					onClick={handleDeleteClick}
					disabled={props.isDeleting}
				/>
			</div>
		</div>
	);
};

export default Card;
