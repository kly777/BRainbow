import { type Component, createSignal, For, Show } from "solid-js";
import styles from "@/styles/components/cardsGrid.module.css";
import Card, { type CardData } from "./Card";

export interface CardsGridProps {
	cards: CardData[];
	columns?: number;
	gap?: number;
	sortBy?: "created" | "updated" | "title";
	sortOrder?: "asc" | "desc";
	showFilters?: boolean;
	onCardClick?: (id: number) => void;
	onCardEdit?: (id: number) => void;
	onCardDelete?: (id: number) => void;
	emptyMessage?: string;
	deletingCardId?: number | null;
}

const CardsGrid: Component<CardsGridProps> = (props) => {
	const [searchQuery, setSearchQuery] = createSignal("");
	const [selectedCategory, setSelectedCategory] = createSignal<string>("全部");
	const [selectedTag, setSelectedTag] = createSignal<string>("");
	const [sortBy, setSortBy] = createSignal<"created" | "updated" | "title">(
		props.sortBy || "updated",
	);
	const [sortOrder, setSortOrder] = createSignal<"asc" | "desc">(
		props.sortOrder || "desc",
	);

	// 检查卡片是否正在被删除
	const isCardDeleting = (cardId: number) => {
		return props.deletingCardId === cardId;
	};

	// 过滤和排序卡片
	const filteredAndSortedCards = () => {
		const filtered = props.cards.filter((card) => {
			const matchesSearch =
				searchQuery() === "" ||
				card.title.toLowerCase().includes(searchQuery().toLowerCase()) ||
				card.content.toLowerCase().includes(searchQuery().toLowerCase());

			return matchesSearch;
		});

		// 排序
		filtered.sort((a, b) => {
			let aValue: string | number;
			let bValue: string | number;

			switch (sortBy()) {
				case "created":
					aValue = new Date(a.created_at).getTime();
					bValue = new Date(b.created_at).getTime();
					break;
				case "updated":
					aValue = new Date(a.updated_at).getTime();
					bValue = new Date(b.updated_at).getTime();
					break;
				case "title":
					aValue = a.title.toLowerCase();
					bValue = b.title.toLowerCase();
					break;
				default:
					aValue = new Date(a.updated_at).getTime();
					bValue = new Date(b.updated_at).getTime();
			}

			if (sortOrder() === "asc") {
				return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
			} else {
				return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
			}
		});

		return filtered;
	};

	// 处理卡片点击
	const handleCardClick = (id: number) => {
		if (props.onCardClick) {
			props.onCardClick(id);
		}
	};

	// 处理卡片编辑
	const handleCardEdit = (id: number) => {
		if (props.onCardEdit) {
			props.onCardEdit(id);
		}
	};

	// 处理卡片删除
	const handleCardDelete = (id: number) => {
		if (props.onCardDelete) {
			props.onCardDelete(id);
		}
	};

	// 切换排序
	const toggleSortOrder = () => {
		setSortOrder(sortOrder() === "asc" ? "desc" : "asc");
	};

	// 清空筛选
	const clearFilters = () => {
		setSearchQuery("");
		setSelectedCategory("全部");
		setSelectedTag("");
	};

	// 网格列样式
	const gridStyle = () => {
		const style: Record<string, string> = {};
		if (props.columns) {
			style["grid-template-columns"] = `repeat(${props.columns}, 1fr)`;
		}
		if (props.gap !== undefined) {
			style.gap = `${props.gap}px`;
		}
		return style;
	};

	return (
		<div class={styles.container}>
			<Show when={props.showFilters !== false}>
				<div class={styles.filters}>
					<div class={styles.searchSection}>
						<input
							type="text"
							class={styles.searchInput}
							placeholder="搜索卡片标题或内容..."
							value={searchQuery()}
							onInput={(e) => setSearchQuery(e.currentTarget.value)}
						/>
						<button
							type="button"
							class={styles.clearButton}
							onClick={clearFilters}
							disabled={
								searchQuery() === "" &&
								selectedCategory() === "全部" &&
								selectedTag() === ""
							}
						>
							清空筛选
						</button>
					</div>

					<div class={styles.filterControls}>
						<div class={styles.sortControls}>
							<div class={styles.filterGroup}>
								<label for="sort-select" class={styles.filterLabel}>
									排序:
								</label>
								<select
									id="sort-select"
									class={styles.filterSelect}
									value={sortBy()}
									onChange={(e) =>
										setSortBy(
											e.currentTarget.value as "created" | "updated" | "title",
										)
									}
								>
									<option value="updated">更新时间</option>
									<option value="created">创建时间</option>
									<option value="title">标题</option>
								</select>
							</div>

							<button
								type="button"
								class={styles.sortButton}
								onClick={toggleSortOrder}
								title={sortOrder() === "asc" ? "升序" : "降序"}
							>
								{sortOrder() === "asc" ? "↑" : "↓"}
							</button>
						</div>
					</div>
				</div>
			</Show>

			<Show
				when={filteredAndSortedCards().length > 0}
				fallback={
					<div class={styles.emptyState}>
						<p>{props.emptyMessage || "没有找到匹配的卡片"}</p>
						<button
							type="button"
							class={styles.clearButton}
							onClick={clearFilters}
						>
							清空筛选条件
						</button>
					</div>
				}
			>
				<div class={styles.cardsGrid} style={gridStyle()}>
					<For each={filteredAndSortedCards()}>
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

			<div class={styles.stats}>
				<p>
					共 {filteredAndSortedCards().length} 张卡片
					{selectedCategory() !== "全部" && ` (分类: ${selectedCategory()})`}
					{selectedTag() !== "" && ` (标签: ${selectedTag()})`}
					{` (排序: ${sortBy() === "updated" ? "更新时间" : sortBy() === "created" ? "创建时间" : "标题"} ${sortOrder() === "asc" ? "升序" : "降序"})`}
				</p>
			</div>
		</div>
	);
};

export default CardsGrid;
