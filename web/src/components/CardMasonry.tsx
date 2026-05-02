import { type Component, For, Show } from "solid-js";
import styles from "./CardsGrid.module.css"
import Card, { type CardData } from "./Card";

export interface CardMasonryProps {
	cards: CardData[];
	onCardClick?: (id: number) => void;
	onCardEdit?: (id: number) => void;
	onCardDelete?: (id: number) => void;
	emptyMessage?: string;
	deletingCardId?: number | null;
}

const CardMasonry: Component<CardMasonryProps> = (props) => {
	const isCardDeleting = (cardId: number) => {
		return props.deletingCardId === cardId;
	};

	const handleCardClick = (id: number) => {
		if (props.onCardClick) props.onCardClick(id);
	};

	const handleCardEdit = (id: number) => {
		if (props.onCardEdit) props.onCardEdit(id);
	};

	const handleCardDelete = (id: number) => {
		if (props.onCardDelete) props.onCardDelete(id);
	};

	return (
		<Show
			when={props.cards.length > 0}
			fallback={
				<div class={styles.emptyState}>
					<p>{props.emptyMessage || "没有卡片"}</p>
				</div>
			}
		>
			<div class={styles.cardsGrid}>
				<For each={props.cards}>
					{(card) => (
						<Card
							{...card}
							onClick={handleCardClick}
							onEdit={handleCardEdit}
							onDelete={handleCardDelete}
							isDeleting={isCardDeleting(card.id)}
						/>
					)}
				</For>
			</div>
		</Show>
	);
};

export default CardMasonry;
