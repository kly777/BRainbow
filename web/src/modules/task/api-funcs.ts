// ── 任务 API 函数 ──

import type { PaginatedResponse } from "@shared/api";
import { buildQuery, cachedRequest } from "@shared/api";
import type { CalendarEvent, Task } from "./api-types.ts";

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

export const getTasksE = (): Promise<PaginatedResponse<Task>> =>
	cachedRequest("/tasks", {});

export const getAllTasksE = (): Promise<PaginatedResponse<Task>> =>
	cachedRequest("/tasks/all", {});
