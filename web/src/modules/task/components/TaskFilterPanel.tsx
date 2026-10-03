// 「筛选 ⚙」面板 + 活动条件 chip
//
// 为什么把状态/标签/优先级/截止**合并**进一个弹出面板：它们都是低频打开、
// 用完即关的条件（06-日历视图 §2）。留在工具条上会把常驻控件撑到 6 个以上，
// 而每个常驻控件都在消耗用户的"解释—回忆—格式化"三重成本。
//
// **活动条件以 chip 常驻在按钮旁**：面板一关条件就看不见了，用户会不知道
// 列表为什么少了东西。chip 可单个删、可清空（S4-m）。

import TagInput, {
	type TagOption,
} from "@components/ui/molecules/TagInput.tsx";
import { For, Show } from "solid-js";
import type { TaskPriority, TaskStatusType } from "../api-types.ts";
import {
	type FilterChip,
	filterChips,
	isFilterEmpty,
	removeChip,
	type TaskFilter,
	toggleValue,
} from "../lib/task-filter.ts";
import styles from "./TaskFilterPanel.module.css";

const STATUS_OPTIONS: readonly { value: TaskStatusType; label: string }[] = [
	{ value: "backlog", label: "待办" },
	{ value: "active", label: "进行中" },
	{ value: "completed", label: "已完成" },
	{ value: "archived", label: "已归档" },
];

const PRIORITY_OPTIONS: readonly { value: TaskPriority; label: string }[] = [
	{ value: "p1", label: "p1" },
	{ value: "p2", label: "p2" },
	{ value: "p3", label: "p3" },
	{ value: "p4", label: "p4" },
];

export interface TaskFilterPanelProps {
	filter: TaskFilter;
	onChange: (filter: TaskFilter) => void;
	/** 标签候选（补全用；不给就只做手动输入） */
	tagOptions?: () => readonly TagOption[];
	searchTags?: (query: string) => Promise<TagOption[]>;
}

export default function TaskFilterPanel(props: TaskFilterPanelProps) {
	const filter = () => props.filter;

	return (
		<fieldset class={styles.panel}>
			<legend class={styles.legend}>筛选</legend>
			<div class={styles.group}>
				<span class={styles.groupLabel}>状态</span>
				<div class={styles.chips}>
					<For each={STATUS_OPTIONS}>
						{(option) => (
							<button
								type="button"
								class={styles.optionChip}
								aria-pressed={filter().status.includes(option.value)}
								onClick={() =>
									props.onChange({
										...filter(),
										status: toggleValue(filter().status, option.value),
									})
								}
							>
								{option.label}
							</button>
						)}
					</For>
				</div>
			</div>

			<div class={styles.group}>
				<span class={styles.groupLabel}>优先级</span>
				<div class={styles.chips}>
					<For each={PRIORITY_OPTIONS}>
						{(option) => (
							<button
								type="button"
								class={styles.optionChip}
								aria-pressed={filter().priority.includes(option.value)}
								onClick={() =>
									props.onChange({
										...filter(),
										priority: toggleValue(filter().priority, option.value),
									})
								}
							>
								{option.label}
							</button>
						)}
					</For>
				</div>
			</div>

			<div class={styles.group}>
				<span class={styles.groupLabel}>标签</span>
				<TagInput
					selected={filter().tags}
					onAdd={(name) =>
						props.onChange({
							...filter(),
							tags: toggleValue(filter().tags, name),
						})
					}
					onRemove={(name) =>
						props.onChange({
							...filter(),
							tags: filter().tags.filter((tag) => tag !== name),
						})
					}
					{...(props.tagOptions ? { allOptions: props.tagOptions } : {})}
					{...(props.searchTags ? { search: props.searchTags } : {})}
					placeholder="加标签（Enter 确认）"
					ariaLabel="按标签筛选"
				/>
			</div>

			<div class={styles.group}>
				<span class={styles.groupLabel}>截止</span>
				<div class={styles.dueRow}>
					<input
						type="date"
						class={styles.dueInput}
						value={filter().dueFrom?.slice(0, 10) ?? ""}
						aria-label="截止起始日"
						onInput={(e) =>
							props.onChange({
								...filter(),
								dueFrom: e.currentTarget.value
									? new Date(e.currentTarget.value).toISOString()
									: null,
							})
						}
					/>
					<span class={styles.dueSep}>~</span>
					<input
						type="date"
						class={styles.dueInput}
						value={filter().dueTo?.slice(0, 10) ?? ""}
						aria-label="截止结束日"
						onInput={(e) =>
							props.onChange({
								...filter(),
								dueTo: e.currentTarget.value
									? new Date(e.currentTarget.value).toISOString()
									: null,
							})
						}
					/>
				</div>
			</div>

			<div class={styles.footer}>
				<Show
					when={!isFilterEmpty(filter())}
					fallback={<span class={styles.emptyHint}>无筛选条件</span>}
				>
					<button
						type="button"
						class={styles.clearAll}
						onClick={() =>
							props.onChange({
								status: [],
								tags: [],
								priority: [],
								dueFrom: null,
								dueTo: null,
							})
						}
					>
						清空全部
					</button>
				</Show>
			</div>
		</fieldset>
	);
}

export interface ActiveFilterChipsProps {
	filter: TaskFilter;
	onChange: (filter: TaskFilter) => void;
}

/** 活动条件 chip 常驻在「筛选 ⚙」按钮旁（面板关掉时条件仍然可见） */
export function ActiveFilterChips(props: ActiveFilterChipsProps) {
	const chips = () => filterChips(props.filter);
	return (
		<Show when={chips().length > 0}>
			{/* ul/li 而不是 div + aria-label：普通 div 没有 role，
			    aria-label 会被读屏忽略，条件在读屏里就没有名字 */}
			<ul class={styles.activeChips} aria-label="当前筛选条件">
				<For each={chips()}>
					{(chip) => (
						<li class={styles.activeChip}>
							{chip.label}
							<button
								type="button"
								class={styles.activeChipRemove}
								aria-label={`移除筛选条件 ${chip.label}`}
								onClick={() => props.onChange(removeChip(props.filter, chip))}
							>
								×
							</button>
						</li>
					)}
				</For>
			</ul>
		</Show>
	);
}

export type { FilterChip };
