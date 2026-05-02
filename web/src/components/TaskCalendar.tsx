import { createMemo, createSignal, For, Show } from "solid-js";
import type { Task } from "@/apis/types";
import styles from "./TaskCalendar.module.css";

// 状态对应颜色类名
const statusColors: Record<string, string> = {
	backlog: styles.statusBacklog ?? "",
	active: styles.statusActive ?? "",
	completed: styles.statusCompleted ?? "",
	archived: styles.statusArchived ?? "",
};

function getStatusColor(status: string): string {
	return statusColors[status] || "";
}

interface TaskCalendarProps {
	tasks: Task[];
}

export default function TaskCalendar(props: TaskCalendarProps) {
	const [currentDate, setCurrentDate] = createSignal<Date>(new Date());

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

	// 获取指定日期的任务
	const getTasksForDate = (date: Date) => {
		return props.tasks.filter((task) => {
			if (!task.created_at) return false;
			const taskDate = new Date(task.created_at);
			return (
				taskDate.getFullYear() === date.getFullYear() &&
				taskDate.getMonth() === date.getMonth() &&
				taskDate.getDate() === date.getDate()
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
									<For each={date ? getTasksForDate(date) : []}>
										{(task) => (
											<div
												class={`${styles.dayTask} ${getStatusColor(task.status || "backlog")}`}
											>
												{task.title}
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
