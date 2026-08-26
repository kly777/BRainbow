import { type CalendarEvent, getCalendarEventsE } from "@modules/task";
import { notifyError, tryAsync } from "@shared/utils";
import { createMemo, createResource, createSignal } from "solid-js";

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

	const [events] = createResource(monthRange, async (range) => {
		const result = await tryAsync(() =>
			getCalendarEventsE(range.start, range.end),
		);
		if (result.ok) return result.value;
		notifyError("获取日历事件失败", result.error);
		return [];
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
		const evts = events();
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
