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
	/** 受控排序（外部持有状态时传入，如过滤栏在组件外渲染的场景） */
	sortBy?: "created" | "updated";
	sortOrder?: "asc" | "desc";
	onLoadMore?: () => void;
	loadingMore?: boolean;
}

const CardsGrid: Component<CardsGridProps> = (props) => {
	const [innerSortBy, setInnerSortBy] = createSignal<"created" | "updated">(
		"updated",
	);
	const [innerSortOrder, setInnerSortOrder] = createSignal<"asc" | "desc">(
		"desc",
	);
	const sortBy = () => props.sortBy ?? innerSortBy();
	const sortOrder = () => props.sortOrder ?? innerSortOrder();

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
						setInnerSortBy(by);
						setInnerSortOrder(order);
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
