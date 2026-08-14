// ── 任务 API 函数 ──

import { cachedRequest } from "@lib/api";
import type { CalendarEvent, TaskListResponse } from "./api-types.ts";

// ==================== Task API Functions ====================

export const getCalendarEventsE = (
	start?: string,
	end?: string,
	status?: string,
): Promise<readonly CalendarEvent[]> => {
	const params = new URLSearchParams();
	if (start) params.set("start", start);
	if (end) params.set("end", end);
	if (status) params.set("status", status);
	const qs = params.toString();
	return cachedRequest(`/tasks/calendar${qs ? `?${qs}` : ""}`, {});
};

export const getTasksE = (): Promise<TaskListResponse> =>
	cachedRequest("/tasks", {});

export const getAllTasksE = (): Promise<TaskListResponse> =>
	cachedRequest("/tasks/all", {});
