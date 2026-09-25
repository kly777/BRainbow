// 任务页工具条：视图切换 + 搜索 + 快速添加（从 TaskManager.tsx 下钻）

import { FilterGroup, SearchInput } from "@components/ui";
import { createSignal } from "solid-js";
import styles from "../TaskManager.module.css";
import { useTasks } from "./TaskProvider.tsx";

export interface TaskToolbarProps {
	viewMode: "list" | "kanban";
	onViewChange: (v: "list" | "kanban") => void;
	searchQuery: string;
	onSearchChange: (q: string) => void;
}

export default function TaskToolbar(props: TaskToolbarProps) {
	const { add, search, reload } = useTasks();
	const [title, setTitle] = createSignal("");

	const doSearch = (q: string) => {
		if (q) search(q);
		else reload();
		props.onSearchChange(q);
	};

	return (
		<div class={styles.toolbar}>
			<FilterGroup
				options={[
					{ value: "list", label: "列表" },
					{ value: "kanban", label: "看板" },
				]}
				selected={props.viewMode}
				onChange={(v) => props.onViewChange(v as "list" | "kanban")}
			/>

			<div class={styles.searchBox}>
				<SearchInput
					value={props.searchQuery}
					onSearch={doSearch}
					placeholder="搜索任务…"
				/>
			</div>

			<div class={styles.quickAddBox}>
				<input
					type="text"
					placeholder="+ 快速添加…"
					aria-label="快速添加任务"
					value={title()}
					onInput={(e) => setTitle(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							const t = title().trim();
							if (!t) return;
							setTitle("");
							add({ title: t });
						}
					}}
					class={styles.quickAddInput}
				/>
			</div>
		</div>
	);
}
