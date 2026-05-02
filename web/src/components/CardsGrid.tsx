import { type Component, createMemo, createSignal } from "solid-js";
import type { CardData } from "./Card";
import CardFilter from "./CardFilter";
import CardMasonry, { type CardMasonryProps } from "./CardMasonry";

export interface CardsGridProps extends Omit<CardMasonryProps, "cards"> {
	cards: CardData[];
	showFilters?: boolean;
	onSearch?: (query: string) => void;
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
					? new Date(a.created_at).getTime()
					: new Date(a.updated_at).getTime();
			const bv =
				sb === "created"
					? new Date(b.created_at).getTime()
					: new Date(b.updated_at).getTime();
			return so === "asc" ? av - bv : bv - av;
		});
		return list;
	});

	return (
		<div style={{ flex: 1, "min-height": 0, "overflow-y": "auto" }}>
			{props.showFilters !== false && (
				<CardFilter
					onSearch={props.onSearch}
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
				emptyMessage={props.emptyMessage}
				deletingCardId={props.deletingCardId}
			/>
		</div>
	);
};

export default CardsGrid;
