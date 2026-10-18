// ── 今天起三天的任务/日程时间线 ──

import { A } from "@solidjs/router";
import { fillPath, PATHS } from "@config/paths";
import { getEventsE } from "../calendarApi.ts";
import { getCalendarEventsE } from "../api.ts";
import { RefreshCw } from "@components/ui/icons";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import styles from "./ThreeDayTimeline.module.css";

interface TimelineItem {
	key: string;
	kind: "task" | "event";
	title: string;
	startMinute: number;
	endMinute: number;
	allDay: boolean;
	taskId?: number;
	windowType?: string;
	status?: string;
}

const DAY_LABELS = ["今天", "明天", "后天"];
const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" });

function startOfDay(date: Date): Date {
	const copy = new Date(date);
	copy.setHours(0, 0, 0, 0);
	return copy;
}

function formatTime(minute: number): string {
	const hours = Math.floor(minute / 60);
	const minutes = minute % 60;
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export default function ThreeDayTimeline() {
	const [refresh, setRefresh] = createSignal(0);
	const days = createMemo(() =>
		Array.from({ length: 3 }, (_, index) => {
			const day = startOfDay(new Date());
			day.setDate(day.getDate() + index);
			return day;
		}),
	);
	const range = createMemo(() => {
		const start = days()[0];
		const end = new Date(days()[2]);
		end.setDate(end.getDate() + 1);
		return { start: start.toISOString(), end: end.toISOString() };
	});

	const [data] = createResource(
		() => `${range().start}|${refresh()}`,
		async () => {
			const [tasks, external] = await Promise.all([
				getCalendarEventsE(range().start, range().end),
				getEventsE(range().start, range().end).catch(() => []),
			]);
			return { tasks, external };
		},
	);

	const itemsFor = (index: number): TimelineItem[] => {
		const dayStart = days()[index];
		const dayEnd = new Date(dayStart);
		dayEnd.setDate(dayEnd.getDate() + 1);
		const items: TimelineItem[] = [];

		for (const event of data()?.tasks ?? []) {
			const start = new Date(event.start);
			const end = new Date(event.end);
			if (start >= dayEnd || end <= dayStart) continue;
			const startMinute = Math.max(
				0,
				Math.round(
					(Math.max(start.getTime(), dayStart.getTime()) - dayStart.getTime()) /
						60000,
				),
			);
			const endMinute = Math.min(
				1440,
				Math.round(
					(Math.min(end.getTime(), dayEnd.getTime()) - dayStart.getTime()) /
						60000,
				),
			);
			items.push({
				key: `task-${event.window_id}-${index}`,
				kind: "task",
				title: event.title,
				startMinute,
				endMinute: Math.max(endMinute, startMinute),
				allDay: false,
				taskId: event.task_id,
				windowType: event.window_type,
				status: event.status,
			});
		}

		for (const event of data()?.external ?? []) {
			const start = new Date(event.start_at);
			const end = new Date(event.end_at);
			if (start >= dayEnd || end <= dayStart) continue;
			items.push({
				key: `event-${event.id}-${index}`,
				kind: "event",
				title: event.title,
				startMinute: event.all_day
					? 0
					: Math.max(
							0,
							Math.round((start.getTime() - dayStart.getTime()) / 60000),
						),
				endMinute: event.all_day
					? 1440
					: Math.min(
							1440,
							Math.round((end.getTime() - dayStart.getTime()) / 60000),
						),
				allDay: event.all_day,
			});
		}

		return items.sort((a, b) => {
			if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
			return a.startMinute - b.startMinute;
		});
	};

	return (
		<section class={styles.card} aria-label="最近三天时间线">
			<header class={styles.head}>
				<div>
					<h2 class={styles.title}>最近 3 天</h2>
					<p class={styles.subtitle}>今天起 · 任务时段与日程</p>
				</div>
				<button
					type="button"
					class={styles.refresh}
					onClick={() => setRefresh((value) => value + 1)}
					aria-label="刷新时间线"
				>
					<RefreshCw size={13} />
				</button>
			</header>

			<Show when={!data.loading} fallback={<p class={styles.muted}>加载中…</p>}>
				<div class={styles.days}>
					<For each={days()}>
						{(day, index) => (
							<section class={styles.day}>
								<header class={styles.dayHead}>
									<strong>{DAY_LABELS[index()]}</strong>
									<span>
										{day.getMonth() + 1}/{day.getDate()} {weekday.format(day)}
									</span>
								</header>
								<Show
									when={itemsFor(index()).length > 0}
									fallback={<p class={styles.muted}>没有安排</p>}
								>
									<ul class={styles.items}>
										<For each={itemsFor(index())}>
											{(item) => (
												<li
													class={styles.item}
													classList={{
														[styles.completed]: item.status === "completed",
														[styles.feasible]: item.windowType === "feasible",
													}}
												>
													<span class={styles.time}>
														{item.allDay
															? "全天"
															: `${formatTime(item.startMinute)}–${formatTime(
																	Math.min(item.endMinute, 1439),
																)}`}
													</span>
													<Show
														when={item.taskId}
														fallback={
															<span class={styles.itemTitle}>{item.title}</span>
														}
													>
														{(taskId) => (
															<A
																class={styles.itemTitle}
																href={fillPath(PATHS.taskDetail, taskId())}
															>
																{item.title}
															</A>
														)}
													</Show>
												</li>
											)}
										</For>
									</ul>
								</Show>
							</section>
						)}
					</For>
				</div>
			</Show>
			<Show when={data.error}>
				<p class={styles.error}>时间线加载失败</p>
			</Show>
		</section>
	);
}
