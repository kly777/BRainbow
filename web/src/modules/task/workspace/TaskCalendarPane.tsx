// ── 日历视图：月网格 / 周·日时间轴，拖拽落位与建议图层 ──

import { showConfirm } from "@components/ui";
import { type Component, Show } from "solid-js";
import type { TaskCalendarApi } from "../hooks/useTaskCalendar.ts";
import { useSuggestions } from "../hooks/useSuggestions.ts";
import { startOfDay } from "../lib/calendar.ts";
import { scheduleWindow } from "../lib/schedule.ts";
import CalendarSettings from "../components/CalendarSettings.tsx";
import CalendarTimeGrid, {
	type ScheduleMove,
} from "../components/CalendarTimeGrid.tsx";
import { adoptSuggestion } from "../components/SuggestionLayer.tsx";
import TaskCalendar from "../components/TaskCalendar.tsx";
import styles from "./TaskCalendarPane.module.css";

export interface TaskCalendarPaneProps {
	calendar: TaskCalendarApi;
	onOpenTask: (taskId: number) => void;
}

const TaskCalendarPane: Component<TaskCalendarPaneProps> = (props) => {
	const rangeStart = () => {
		const days = props.calendar.visibleDays();
		const first = days[0];
		return first ? startOfDay(first) : startOfDay(props.calendar.currentDate());
	};
	const rangeEnd = () => {
		const days = props.calendar.visibleDays();
		const last = days[days.length - 1];
		const base = last
			? startOfDay(last)
			: startOfDay(props.calendar.currentDate());
		const next = new Date(base);
		next.setDate(next.getDate() + 1);
		return next;
	};
	const suggestions = useSuggestions(rangeStart, rangeEnd);

	const handleSchedule = (move: ScheduleMove) => {
		void scheduleWindow(
			{
				windowId: move.windowId,
				dayKey: move.dayKey,
				startMinute: move.startMinute,
				endMinute: move.endMinute,
				previous: move.previous,
			},
			() => {
				props.calendar.reload();
				suggestions.refresh();
			},
		);
	};

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
				props.calendar.reload();
				suggestions.refresh();
			}
		});
	};

	return (
		<section class={styles.pane} aria-label="任务日历">
			<CalendarSettings calendar={props.calendar} />
			<Show
				when={props.calendar.granularity() === "month"}
				fallback={
					<CalendarTimeGrid
						calendar={props.calendar}
						onOpenTask={props.onOpenTask}
						onSchedule={handleSchedule}
						onScheduled={() => {
							props.calendar.reload();
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
				<TaskCalendar calendar={props.calendar} onOpenTask={props.onOpenTask} />
			</Show>
		</section>
	);
};

export default TaskCalendarPane;
