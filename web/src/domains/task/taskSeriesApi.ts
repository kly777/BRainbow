// ── 循环任务系列 ──

import { request } from "@shared/api";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurrenceRule {
	calendar: "gregorian" | "lunar" | "solar_term";
	freq?: RecurrenceFrequency;
	interval?: number;
	by_weekdays?: number[];
	until?: string | null;
	count?: number | null;
	month?: number | null;
	day?: number | null;
	leap?: "regular" | "leap" | "skip" | null;
	missing_day?: "skip" | "last_day" | "next_month_first_day" | null;
	term?: string | null;
	special?: string | null;
}

export interface TaskSeries {
	id: number;
	title: string;
	description: string | null;
	priority: string | null;
	effort_estimate_minutes: number | null;
	recurrence: RecurrenceRule;
	recurrence_anchor: "due" | "completion";
	timezone: string;
	starts_on: string;
	due_time_minutes: number | null;
	next_occurrence_on: string | null;
}

export interface CreateTaskSeriesInput {
	title: string;
	description?: string | null;
	priority?: string | null;
	effort_estimate_minutes?: number | null;
	recurrence: RecurrenceRule;
	recurrence_anchor?: "due" | "completion";
	timezone?: string;
	starts_on: string;
	due_time_minutes?: number | null;
}

export const getTaskSeriesE = (): Promise<readonly TaskSeries[]> =>
	request<readonly TaskSeries[]>("/tasks/series");

export const createTaskSeriesE = (
	input: CreateTaskSeriesInput,
): Promise<TaskSeries> =>
	request<TaskSeries>("/tasks/series", {
		method: "POST",
		body: JSON.stringify(input),
	});

export const deleteTaskSeriesE = (id: number): Promise<void> =>
	request<void>(`/tasks/series/${id}`, { method: "DELETE" });
