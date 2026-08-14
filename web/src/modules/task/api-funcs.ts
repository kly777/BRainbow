// ── 任务 API 函数 ──

import { buildQuery, cachedRequest } from "@lib/api";
import type { CalendarEvent, TaskListResponse } from "./api-types.ts";

// ==================== Task API Functions ====================

export const getCalendarEventsE = (
	start?: string,
	end?: string,
	status?: string,
): Promise<readonly CalendarEvent[]> => {
	return cachedRequest(
		`/tasks/calendar${buildQuery({ start, end, status })}`,
		{},
	);
};

export const getTasksE = (): Promise<TaskListResponse> =>
	cachedRequest("/tasks", {});

export const getAllTasksE = (): Promise<TaskListResponse> =>
	cachedRequest("/tasks/all", {});
