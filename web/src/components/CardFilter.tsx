import { type Component, createSignal } from "solid-js";
import styles from "./CardsGrid.module.css";

export interface CardFilterProps {
    onSearch?: (query: string) => void;
    sortBy?: "created" | "updated";
    sortOrder?: "asc" | "desc";
    onSortChange?: (by: "created" | "updated", order: "asc" | "desc") => void;
}

const CardFilter: Component<CardFilterProps> = (props) => {
    const [searchQuery, setSearchQuery] = createSignal("");
    const [sortBy, setSortBy] = createSignal<"created" | "updated">(
        props.sortBy || "updated",
    );
    const [sortOrder, setSortOrder] = createSignal<"asc" | "desc">(
        props.sortOrder || "desc",
    );

    const toggleSortOrder = () => {
        const next = sortOrder() === "asc" ? "desc" : "asc";
        setSortOrder(next);
        props.onSortChange?.(sortBy(), next);
    };

    const handleSortBy = (value: string) => {
        const by = value as "created" | "updated";
        setSortBy(by);
        props.onSortChange?.(by, sortOrder());
    };

    const handleSearch = () => {
        props.onSearch?.(searchQuery().trim());
    };

    const clearSearch = () => {
        setSearchQuery("");
        props.onSearch?.("");
    };

    return (
        <div class={styles.filters}>
            <div class={styles.filterRow}>
                <div class={styles.filterControls}>
                    <input
                        type="text"
                        class={styles.searchInput}
                        placeholder="搜索卡片..."
                        value={searchQuery()}
                        onInput={(e) => setSearchQuery(e.currentTarget.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleSearch();
                        }}
                    />
                    <span class={styles.filterLabel}>排序:</span>
                    <select
                        class={styles.filterSelect}
                        value={sortBy()}
                        onChange={(e) => handleSortBy(e.currentTarget.value)}
                    >
                        <option value="updated">更新时间</option>
                        <option value="created">创建时间</option>
                    </select>
                    <button
                        type="button"
                        class={styles.sortButton}
                        onClick={toggleSortOrder}
                        title={sortOrder() === "asc" ? "升序" : "降序"}
                    >
                        {sortOrder() === "asc" ? "↑" : "↓"}
                    </button>
                    <button
                        type="button"
                        class={styles.clearButton}
                        onClick={clearSearch}
                        disabled={searchQuery() === ""}
                    >
                        清空
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CardFilter;
