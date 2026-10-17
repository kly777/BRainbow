// ── 日历事件 / 未来 7 天 / 农历换算的客户端 ──
//
// 这些端点不参与 tasks 的缓存域：列表短、变更多，直接 request 更省心。
// 采用 `request`（不是 cachedRequest）也避免了再给 domainPolicies 加一套正则。

import { request } from "@shared/api";

export type EventKind = "birthday" | "anniversary" | "festival" | "event";
export type CalendarKind = "gregorian" | "lunar" | "solar_term";

export interface UpcomingEvent {
	id: number;
	date: string;
	kind: EventKind;
	title: string;
	age: number | null;
	years: number | null;
	days_until: number;
	is_today: boolean;
	all_day: boolean;
}

export interface ExternalEvent {
	id: number;
	series_id: number | null;
	occurrence_on: string | null;
	occurrence_year: number | null;
	title: string;
	notes: string | null;
	start_at: string;
	end_at: string;
	all_day: boolean;
	busy: boolean;
	kind: EventKind;
	source: string;
	age: number | null;
	years: number | null;
}

export interface CalendarItem {
	item_type: "task_block" | "event";
	id: number;
	task_id: number | null;
	title: string;
	start_at: string;
	end_at: string | null;
	all_day: boolean;
	fixed: boolean;
	kind: string;
	status: string | null;
	priority: string | null;
	busy: boolean | null;
}

export interface EventSeries {
	id: number;
	preset_key: string | null;
	title: string;
	notes: string | null;
	kind: EventKind;
	calendar: CalendarKind;
	month: number | null;
	day: number | null;
	term: string | null;
	special: string | null;
	leap_policy: "regular" | "leap" | "skip" | null;
	missing_day_policy: "skip" | "last_day" | "next_month_first_day";
	born_in_leap_month: boolean;
	since_year: number | null;
	since_on: string | null;
	all_day: boolean;
	busy: boolean;
	upcoming_days: number;
	timezone: string;
	starts_on: string;
}

export interface CreateEventSeriesInput {
	title: string;
	notes?: string | null;
	kind: EventKind;
	calendar: CalendarKind;
	month?: number | null;
	day?: number | null;
	term?: string | null;
	special?: string | null;
	leap_policy?: "regular" | "leap" | "skip" | null;
	missing_day_policy?: "skip" | "last_day" | "next_month_first_day";
	born_in_leap_month?: boolean;
	since_year?: number | null;
	since_on?: string | null;
	all_day: boolean;
	busy: boolean;
	upcoming_days?: number;
	timezone?: string;
	starts_on: string;
}

export interface LunarDateInfo {
	solar: string;
	lunar_year: number;
	lunar_month: number;
	lunar_day: number;
	is_leap_month: boolean;
	lunar_label: string;
}

export const getUpcomingE = (days = 7): Promise<readonly UpcomingEvent[]> =>
	request<readonly UpcomingEvent[]>(`/calendar/upcoming?days=${days}`);

export const getEventsE = (
	start: string,
	end: string,
): Promise<readonly ExternalEvent[]> =>
	request<readonly ExternalEvent[]>(
		`/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
	);

export const getCalendarItemsE = (
	start: string,
	end: string,
): Promise<readonly CalendarItem[]> =>
	request<readonly CalendarItem[]>(
		`/calendar/items?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
	);

export const convertLunarE = (date: string): Promise<LunarDateInfo> =>
	request<LunarDateInfo>(
		`/calendar/lunar/convert?date=${encodeURIComponent(date)}`,
	);

export const getEventSeriesE = (): Promise<readonly EventSeries[]> =>
	request<readonly EventSeries[]>("/calendar/events/series");

export const createEventSeriesE = (
	input: CreateEventSeriesInput,
): Promise<EventSeries> =>
	request<EventSeries>("/calendar/events/series", {
		method: "POST",
		body: JSON.stringify(input),
	});

export const deleteEventSeriesE = (id: number): Promise<void> =>
	request<void>(`/calendar/events/series/${id}`, { method: "DELETE" });

export interface Festival {
	key: string;
	title: string;
	calendar: CalendarKind;
	month: number | null;
	day: number | null;
	term: string | null;
	special: string | null;
	note: string;
}

export const getFestivalsE = (): Promise<readonly Festival[]> =>
	request<readonly Festival[]>("/calendar/festivals");

export const subscribeFestivalsE = (
	keys: readonly string[],
): Promise<readonly EventSeries[]> =>
	request<readonly EventSeries[]>("/calendar/festivals/subscribe", {
		method: "POST",
		body: JSON.stringify({ keys }),
	});
