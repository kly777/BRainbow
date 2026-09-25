import { notifyError, useListResource } from "@shared/utils";
import { createMemo, createSignal } from "solid-js";
import { type CalendarEvent, getCalendarEventsE } from "../api.ts";

export interface TaskCalendarApi {
	currentDate: () => Date;
	monthTitle: () => string;
	daysInMonth: () => readonly (Date | null)[];
	getEventsForDate: (date: Date) => readonly CalendarEvent[];
	changeMonth: (delta: number) => void;
}

export function useTaskCalendar(): TaskCalendarApi {
	const [currentDate, setCurrentDate] = createSignal<Date>(new Date());

	const monthRange = createMemo(() => {
		const d = currentDate();
		const y = d.getFullYear();
		const m = d.getMonth();
		return {
			start: new Date(y, m, 1).toISOString(),
			end: new Date(y, m + 1, 0, 23, 59, 59).toISOString(),
		};
	});

	// 月份区间即请求键；端点给数组，交原语归一（错误经 onError 提示，
	// 日历没有错误态槽位，只在这里 toast 一次）
	const list = useListResource<{ start: string; end: string }, CalendarEvent>({
		key: monthRange,
		fetcher: (range) => getCalendarEventsE(range.start, range.end),
		onError: () => notifyError("获取日历事件失败"),
	});

	const changeMonth = (delta: number) => {
		const newDate = new Date(currentDate());
		newDate.setMonth(newDate.getMonth() + delta);
		setCurrentDate(newDate);
	};

	const daysInMonth = createMemo(() => {
		const date = currentDate();
		const year = date.getFullYear();
		const month = date.getMonth();
		const firstDay = new Date(year, month, 1);
		const lastDay = new Date(year, month + 1, 0);
		const count = lastDay.getDate();
		const startDow = firstDay.getDay();

		const days: (Date | null)[] = [];
		for (let i = 0; i < startDow; i++) days.push(null);
		for (let i = 1; i <= count; i++) days.push(new Date(year, month, i));
		while (days.length % 7 !== 0) days.push(null);
		return days;
	});

	const eventsByDate = createMemo(() => {
		const map = new Map<string, CalendarEvent[]>();
		const evts = list.items();
		if (!evts) return map;
		for (const ev of evts) {
			const d = new Date(ev.start);
			const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
			const list = map.get(key);
			if (list) list.push(ev);
			else map.set(key, [ev]);
		}
		return map;
	});

	const getEventsForDate = (date: Date): readonly CalendarEvent[] => {
		const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
		return eventsByDate().get(key) ?? [];
	};

	const monthTitle = () => {
		const date = currentDate();
		return `${date.getFullYear()}年${date.getMonth() + 1}月`;
	};

	return {
		currentDate,
		monthTitle,
		daysInMonth,
		getEventsForDate,
		changeMonth,
	};
}
