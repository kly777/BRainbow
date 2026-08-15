import { parseUtc } from "@lib/utils";
import { type Component, createMemo, createSignal } from "solid-js";
import type { CardData } from "./Card.tsx";
import CardFilter from "./CardFilter.tsx";
import CardMasonry, { type CardMasonryProps } from "./CardMasonry.tsx";
import styles from "./CardsGrid.module.css";

export interface CardsGridProps extends Omit<CardMasonryProps, "cards"> {
	cards: readonly CardData[];
	showFilters?: boolean;
	onSearch?: (query: string) => void;
	initialSearchQuery?: string;
	onLoadMore?: () => void;
	loadingMore?: boolean;
}

const CardsGrid: Component<CardsGridProps> = (props) => {
	const [sortBy, setSortBy] = createSignal<"created" | "updated">("updated");
	const [sortOrder, setSortOrder] = createSignal<"asc" | "desc">("desc");

	const sortedCards = createMemo(() => {
		const list = [...props.cards];
		const sb = sortBy();
		const so = sortOrder();
		list.sort((a, b) => {
			const av =
				sb === "created"
					? parseUtc(a.created_at).getTime()
					: parseUtc(a.updated_at).getTime();
			const bv =
				sb === "created"
					? parseUtc(b.created_at).getTime()
					: parseUtc(b.updated_at).getTime();
			return so === "asc" ? av - bv : bv - av;
		});
		return list;
	});

	return (
		<div class={styles.body}>
			{props.showFilters !== false && (
				<CardFilter
					onSearch={props.onSearch}
					initialQuery={props.initialSearchQuery}
					sortBy={sortBy()}
					sortOrder={sortOrder()}
					onSortChange={(by, order) => {
						setSortBy(by);
						setSortOrder(order);
					}}
				/>
			)}
			<CardMasonry
				cards={sortedCards()}
				onCardClick={props.onCardClick}
				onCardEdit={props.onCardEdit}
				onCardDelete={props.onCardDelete}
				onLoadMore={props.onLoadMore}
				loadingMore={props.loadingMore}
				emptyMessage={props.emptyMessage}
				deletingCardId={props.deletingCardId}
			/>
		</div>
	);
};

export default CardsGrid;
