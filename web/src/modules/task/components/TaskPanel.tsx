// 任务主视图：列表 + 右栏（日历/依赖图）或看板（从 TaskManager.tsx 下钻）

import { FilterGroup, LoadingSkeleton, showConfirm } from "@components/ui";
import { createEffect, createSignal, Show } from "solid-js";
import { useSuggestions } from "../hooks/useSuggestions.ts";
import { useTaskCalendar } from "../hooks/useTaskCalendar.ts";
import { startOfDay } from "../lib/calendar.ts";
import { scheduleWindow } from "../lib/schedule.ts";
import { EMPTY_FILTER, isFilterEmpty } from "../lib/task-filter.ts";
import styles from "../TaskManager.module.css";
import CalendarSettings from "./CalendarSettings.tsx";
import CalendarTimeGrid, { type ScheduleMove } from "./CalendarTimeGrid.tsx";
import { adoptSuggestion } from "./SuggestionLayer.tsx";
import TaskCalendar from "./TaskCalendar.tsx";
import TaskDag from "./TaskDag.tsx";
import TaskDrawer from "./TaskDrawer.tsx";
import { TaskEmpty } from "./TaskEmpty.tsx";
import TaskKanban from "./TaskKanban.tsx";
import TaskList from "./TaskList.tsx";
import { useTasks } from "./TaskProvider.tsx";

export interface TaskPanelProps {
	viewMode: "list" | "kanban";
	rightTab: "calendar" | "dag";
	onRightTabChange: (t: "calendar" | "dag") => void;
	/** 搜索词（URL 参数）：空态要靠它区分"筛空"与"真的没任务" */
	searchQuery: string;
	/** 清掉搜索词（筛选由面板自己清，两者分属 URL 与 provider） */
	onClearSearch: () => void;
}

export default function TaskPanel(props: TaskPanelProps) {
	const {
		tasks,
		loading,
		updateStatus,
		removeTask,
		updateTaskE,
		addSubTask,
		filter,
		setFilter,
		setQuery,
	} = useTasks();

	// 空态分两种（见 TaskEmpty）：有筛选或搜索 → 空是用户自己造成的；
	// 都没有还空 → 收件箱真的空
	const filtered = () =>
		!isFilterEmpty(filter()) || props.searchQuery.trim() !== "";
	const clearFilters = () => {
		setFilter(EMPTY_FILTER);
		props.onClearSearch();
	};

	/**
	 * 搜索词落进数据层 —— **只在这一处**。
	 *
	 * 工具条只把它写进 URL（见 TaskToolbar 的 doSearch），由这里统一应用：
	 * 输入框防抖之后、带着 `?q=` 首屏进来、刷新、前进后退，走的是同一条路径。
	 * 初值给 ""（provider 的 onMount 已经拉过一次全量），否则首屏会多打一次请求。
	 */
	let appliedQuery = "";
	createEffect(() => {
		const q = props.searchQuery;
		if (q === appliedQuery) return;
		appliedQuery = q;
		setQuery(q);
	});
	// 点日历事件 → 抽屉。抽屉与日历**并排**而非叠放（S4-e：模态会盖掉日历这个参照物）
	const [openTaskId, setOpenTaskId] = createSignal<number | null>(null);
	// 日历状态建**一份**再传下去：网格与设置条共享，否则各自一份状态、各发一次请求
	const calendar = useTaskCalendar();

	// 落位（拖完 / 键盘改完）：新建走"一次请求建任务+窗口"，移动走 PATCH 那条时间窗。
	// 失败时的反馈契约见 lib/schedule.ts 的注释
	const handleSchedule = (move: ScheduleMove) => {
		void scheduleWindow(
			{
				windowId: move.windowId,
				dayKey: move.dayKey,
				startMinute: move.startMinute,
				endMinute: move.endMinute,
				previous: move.previous,
			},
			() => calendar.reload(),
		);
	};

	// 建议图层：端点**只算不写**（P9），采纳是用户显式的一次点击。
	// 区间跟着日历当前看的那一段走（周/日视就是这一周/这一天）
	const rangeStart = () => {
		const days = calendar.visibleDays();
		const first = days[0];
		return first ? startOfDay(first) : startOfDay(calendar.currentDate());
	};
	const rangeEnd = () => {
		const days = calendar.visibleDays();
		const last = days[days.length - 1];
		const base = last ? startOfDay(last) : startOfDay(calendar.currentDate());
		const next = new Date(base);
		next.setDate(next.getDate() + 1);
		return next;
	};
	const suggestions = useSuggestions(rangeStart, rangeEnd);

	// 采纳一条建议。落在 `feasible` 之外时**问一次**（05 §3.5 的方案 C）：
	// 不静默排，也不自动建配套的 `feasible` 去污染用户数据
	const adopt = (taskId: number, start: string, end: string) => {
		void adoptSuggestion(taskId, start, end, async (s, e) => {
			const from = new Date(s).toLocaleString("zh-CN", {
				month: "numeric",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
			const until = new Date(e).toLocaleString("zh-CN", {
				hour: "2-digit",
				minute: "2-digit",
			});
			return showConfirm({
				title: "这段不在你标记的可行时段里",
				message: `${from}–${until} 仍要排上吗？可行时段是给计划任务用的，这里只是系统的一个猜测。`,
				confirmLabel: "排上",
			});
		}).then((ok) => {
			if (ok) {
				calendar.reload();
				suggestions.refresh();
			}
		});
	};

	return (
		<Show
			when={loading()}
			fallback={
				<>
					<Show when={props.viewMode === "list"}>
						<div class={styles.splitView}>
							{/* 空态落在列表本该占的那一列里（右栏不受影响：日历/依赖图与有没有任务无关） */}
							<Show
								when={tasks().length > 0}
								fallback={
									<TaskEmpty
										filtered={filtered()}
										onClear={clearFilters}
										class={styles.listEmpty}
									/>
								}
							>
								<TaskList
									tasks={tasks()}
									onStatusChange={updateStatus}
									onDelete={removeTask}
									onUpdate={updateTaskE}
									onAddSubTask={addSubTask}
								/>
							</Show>
							<div class={styles.rightPanel}>
								<FilterGroup
									options={[
										{ value: "calendar", label: "日历" },
										{ value: "dag", label: "依赖图" },
									]}
									selected={props.rightTab}
									onChange={(t) =>
										props.onRightTabChange(t as "calendar" | "dag")
									}
								/>
								<Show when={props.rightTab === "calendar"}>
									{/* 设置条放在日历自己上方，不占主工具条的常驻控件预算 */}
									<CalendarSettings calendar={calendar} />
									{/* 月网格 / 周·日时间轴共用同一份状态（见 hooks/useTaskCalendar） */}
									<Show
										when={calendar.granularity() === "month"}
										fallback={
											<CalendarTimeGrid
												calendar={calendar}
												onOpenTask={setOpenTaskId}
												onSchedule={handleSchedule}
												onScheduled={() => {
													calendar.reload();
													suggestions.refresh();
												}}
												showSuggestions={suggestions.enabled()}
												suggestionsEnabled={suggestions.enabled}
												onToggleSuggestions={suggestions.setEnabled}
												unscheduled={suggestions.unscheduled}
												capacity={suggestions.capacity()}
												suggestions={suggestions.suggestions}
												onAdoptSuggestion={adopt}
											/>
										}
									>
										<TaskCalendar
											calendar={calendar}
											onOpenTask={setOpenTaskId}
										/>
									</Show>
									<TaskDrawer
										taskId={openTaskId()}
										onClose={() => setOpenTaskId(null)}
										onUpdate={updateTaskE}
									/>
								</Show>
								<Show when={props.rightTab === "dag"}>
									<TaskDag />
								</Show>
							</div>
						</div>
					</Show>
					<Show when={props.viewMode === "kanban"}>
						{/* 看板整板为空时给同一份空态 —— 否则四列各说一句"拖拽任务到此列" */}
						<Show
							when={tasks().length > 0}
							fallback={
								<TaskEmpty filtered={filtered()} onClear={clearFilters} />
							}
						>
							<TaskKanban />
						</Show>
					</Show>
				</>
			}
		>
			<LoadingSkeleton />
		</Show>
	);
}
