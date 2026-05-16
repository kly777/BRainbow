import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { Effect } from "effect";
import { getCalendarEvents } from "../../apis/taskApi.ts";
import type { CalendarEvent } from "../../apis/types/index.ts";
import { getErrorMessage } from "../../apis/types/index.ts";
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

export default function TaskCalendar() {
	const [currentDate, setCurrentDate] = createSignal<Date>(new Date());

	// 计算当前月份的范围
	const monthRange = createMemo(() => {
		const d = currentDate();
		const y = d.getFullYear();
		const m = d.getMonth();
		return {
			start: new Date(y, m, 1).toISOString(),
			end: new Date(y, m + 1, 0, 23, 59, 59).toISOString(),
		};
	});

	// 获取日历事件
	const [events] = createResource(monthRange, async (range) => {
		try {
			return await Effect.runPromise(
				getCalendarEvents(range.start, range.end),
			);
		} catch (e) {
			console.error("获取日历事件失败:", getErrorMessage(e));
			return [];
		}
	});

	// 切换月份
	const changeMonth = (delta: number) => {
		const newDate = new Date(currentDate());
		newDate.setMonth(newDate.getMonth() + delta);
		setCurrentDate(newDate);
	};

	// 获取当前月份的天数（响应式）
	const daysInMonth = createMemo(() => {
		const date = currentDate();
		const year = date.getFullYear();
		const month = date.getMonth();
		const firstDay = new Date(year, month, 1);
		const lastDay = new Date(year, month + 1, 0);
		const daysInMonthCount = lastDay.getDate();
		const startDayOfWeek = firstDay.getDay();

		const days: (Date | null)[] = [];
		for (let i = 0; i < startDayOfWeek; i++) {
			days.push(null);
		}
		for (let i = 1; i <= daysInMonthCount; i++) {
			days.push(new Date(year, month, i));
		}
		return days;
	});

	// 获取指定日期的日历事件
	const getEventsForDate = (date: Date): readonly CalendarEvent[] => {
		const evts = events();
		if (!evts) return [];
		return evts.filter((ev) => {
			const evStart = new Date(ev.start);
			return (
				evStart.getFullYear() === date.getFullYear() &&
				evStart.getMonth() === date.getMonth() &&
				evStart.getDate() === date.getDate()
			);
		});
	};

	return (
		<div class={styles.calendarView}>
			<div class={styles.calendarHeader}>
				<button
					type="button"
					onClick={() => changeMonth(-1)}
					class={styles.navButton}
				>
					← 上月
				</button>
				<h2 class={styles.calendarTitle}>
					{currentDate().getFullYear()}年{currentDate().getMonth() + 1}月
				</h2>
				<button
					type="button"
					onClick={() => changeMonth(1)}
					class={styles.navButton}
				>
					下月 →
				</button>
			</div>

			<div class={styles.calendarGrid}>
				<div class={styles.dayHeader}>周日</div>
				<div class={styles.dayHeader}>周一</div>
				<div class={styles.dayHeader}>周二</div>
				<div class={styles.dayHeader}>周三</div>
				<div class={styles.dayHeader}>周四</div>
				<div class={styles.dayHeader}>周五</div>
				<div class={styles.dayHeader}>周六</div>

				<For each={daysInMonth()}>
					{(date) => (
						<div class={`${styles.calendarDay} ${date ? "" : styles.empty}`}>
							<Show when={date !== null}>
								<div class={styles.dayNumber}>{date?.getDate()}</div>
								<div class={styles.dayTasks}>
									<For each={date ? getEventsForDate(date) : []}>
										{(ev) => (
											<div
												class={`${styles.dayTask} ${getWindowTypeColor(ev.window_type)}`}
												title={`${ev.title} (${ev.window_type})`}
											>
												<span class={styles.eventTime}>
													{new Date(ev.start).toLocaleTimeString("zh-CN", {
														hour: "2-digit",
														minute: "2-digit",
													})}
												</span>
												{ev.title}
											</div>
										)}
									</For>
								</div>
							</Show>
						</div>
					)}
				</For>
			</div>
		</div>
	);
}
