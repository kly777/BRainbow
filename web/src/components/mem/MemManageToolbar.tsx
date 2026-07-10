import Button from "../ui/Button.tsx";
import FilterGroup from "../ui/FilterGroup.tsx";
import SearchInput from "../ui/SearchInput.tsx";
import styles from "./MemManageToolbar.module.css";

interface Props {
	searchQuery: string;
	filterState: string;
	onSearch: (value: string) => void;
	onFilterChange: (state: string) => void;
	onExport: () => void;
}

const FILTER_OPTIONS = [
	{ value: "all", label: "全部" },
	{ value: "new", label: "新" },
	{ value: "learning", label: "学习" },
	{ value: "review", label: "复习" },
	{ value: "relearning", label: "重学" },
	{ value: "suspended", label: "挂起" },
	{ value: "today_done", label: "已复习" },
];

export default function MemManageToolbar(props: Props) {
	return (
		<div class={styles.toolbar}>
			<SearchInput
				value={props.searchQuery}
				onSearch={props.onSearch}
				placeholder="搜索线索或答案…"
			/>
			<Button variant="ghost" size="sm" onClick={props.onExport}>
				导出
			</Button>
			<FilterGroup
				options={FILTER_OPTIONS}
				selected={props.filterState}
				onChange={props.onFilterChange}
			/>
		</div>
	);
}
