import { ChevronLeft, ChevronRight } from "@components/ui/icons";
import type { CalendarEvent } from "@modules/task";
import { fmtLocal } from "@shared/utils";
import { type Component, For, Show } from "solid-js";
import { useTaskCalendar } from "../hooks/useTaskCalendar.ts";
import styles from "./TaskCalendar.module.css";

// 窗口类型对应颜色
const windowTypeColors: Record<string, string> = {
	feasible: styles.typeFeasible ?? "",
	planned: styles.typePlanned ?? "",
	actual: styles.typeActual ?? "",
};

function getWindowTypeColor(wt: string): string {
	return windowTypeColors[wt] || windowTypeColors.planned || "";
}

function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

const CalendarEventItem: Component<{ ev: CalendarEvent }> = (props) => (
	<div
		class={`${styles.dayTask} ${getWindowTypeColor(props.ev.window_type)}`}
		title={`${props.ev.title} (${props.ev.window_type})`}
	>
		<span class={styles.eventTime}>{fmtLocal(props.ev.start)}</span>
		{props.ev.title}
	</div>
);

type CalendarDayCellProps = {
	date: Date | null;
	today: Date;
	events: readonly CalendarEvent[];
};

const CalendarDayCell: Component<CalendarDayCellProps> = (props) => (
	<div
		classList={{
			[styles.calendarDay]: true,
			[styles.today]: props.date !== null && isSameDay(props.date, props.today),
			[styles.empty]: props.date === null,
		}}
	>
		<Show when={props.date !== null}>
			<div class={styles.dayNumber}>{props.date?.getDate()}</div>
			<div class={styles.dayTasks}>
				<For each={props.date ? props.events : []}>
					{(ev) => <CalendarEventItem ev={ev} />}
				</For>
			</div>
		</Show>
	</div>
);

export default function TaskCalendar() {
	const m = useTaskCalendar();
	const today = new Date();

	return (
		<div class={styles.calendarView}>
			<div class={styles.calendarHeader}>
				<button
					type="button"
					onClick={() => m.changeMonth(-1)}
					class={styles.navButton}
				>
					<ChevronLeft size={14} /> 上月
				</button>
				<h2 class={styles.calendarTitle}>{m.monthTitle()}</h2>
				<button
					type="button"
					onClick={() => m.changeMonth(1)}
					class={styles.navButton}
				>
					下月 <ChevronRight size={14} />
				</button>
			</div>

			<div class={styles.calendarGrid}>
				{/* Desktop headers */}
				<div class={`${styles.dayHeader} ${styles.dayHeaderFull}`}>周日</div>
				<div class={`${styles.dayHeader} ${styles.dayHeaderFull}`}>周一</div>
				<div class={`${styles.dayHeader} ${styles.dayHeaderFull}`}>周二</div>
				<div class={`${styles.dayHeader} ${styles.dayHeaderFull}`}>周三</div>
				<div class={`${styles.dayHeader} ${styles.dayHeaderFull}`}>周四</div>
				<div class={`${styles.dayHeader} ${styles.dayHeaderFull}`}>周五</div>
				<div class={`${styles.dayHeader} ${styles.dayHeaderFull}`}>周六</div>
				{/* Mobile abbreviated headers */}
				<div class={`${styles.dayHeader} ${styles.dayHeaderShort}`}>日</div>
				<div class={`${styles.dayHeader} ${styles.dayHeaderShort}`}>一</div>
				<div class={`${styles.dayHeader} ${styles.dayHeaderShort}`}>二</div>
				<div class={`${styles.dayHeader} ${styles.dayHeaderShort}`}>三</div>
				<div class={`${styles.dayHeader} ${styles.dayHeaderShort}`}>四</div>
				<div class={`${styles.dayHeader} ${styles.dayHeaderShort}`}>五</div>
				<div class={`${styles.dayHeader} ${styles.dayHeaderShort}`}>六</div>

				<For each={m.daysInMonth()}>
					{(date) => (
						<CalendarDayCell
							date={date}
							today={today}
							events={date ? m.getEventsForDate(date) : []}
						/>
					)}
				</For>
			</div>
		</div>
	);
}
