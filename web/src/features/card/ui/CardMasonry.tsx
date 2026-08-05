import { type Component, createEffect, For, Show } from "solid-js";
import Card, { type CardData } from "./Card.tsx";
import * as styles from "./CardMasonry.css.ts";

export interface CardMasonryProps {
	cards: CardData[];
	onCardClick?: (id: number) => void;
	onCardEdit?: (id: number) => void;
	onCardDelete?: (id: number) => void;
	onLoadMore?: () => void;
	loadingMore?: boolean;
	emptyMessage?: string;
	deletingCardId?: number | null;
}

const SCROLL_THRESHOLD = 0.8; // 滚动到 80% 时触发加载

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

	let scrollRef: HTMLDivElement | undefined;

	const handleScroll = () => {
		if (!scrollRef || !props.onLoadMore) return;
		const { scrollLeft, scrollWidth, clientWidth } = scrollRef;
		if (scrollLeft + clientWidth >= scrollWidth * SCROLL_THRESHOLD) {
			props.onLoadMore();
		}
	};

	// 滚轮垂直滚动 → 映射为水平滚动（免 Shift）
	const handleWheel = (e: WheelEvent) => {
		if (!scrollRef) return;
		e.preventDefault();
		scrollRef.scrollLeft += e.deltaY;
	};

	// 内容未撑满时自动加载下一页，直到填满视口或没有更多
	createEffect(() => {
		props.cards.length; // 依赖卡片变化
		props.loadingMore; // 依赖加载状态
		queueMicrotask(() => {
			if (!scrollRef || !props.onLoadMore || props.loadingMore) return;
			const { scrollWidth, clientWidth } = scrollRef;
			if (scrollWidth <= clientWidth + 2) {
				props.onLoadMore();
			}
		});
	});

	return (
		<Show
			when={props.cards.length > 0}
			fallback={
				<div class={styles.emptyState}>
					<p>{props.emptyMessage || "没有卡片"}</p>
				</div>
			}
		>
			<div
				ref={scrollRef}
				class={styles.cardsGrid}
				onScroll={handleScroll}
				onWheel={handleWheel}
			>
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
				<Show when={props.loadingMore}>
					<div class={styles.loadingMore}>加载中...</div>
				</Show>
			</div>
		</Show>
	);
};

export default CardMasonry;
