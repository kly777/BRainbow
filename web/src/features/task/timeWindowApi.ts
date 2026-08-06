import { request } from "@apis/request.ts";
import { CACHE, cachedRequest, tapInvalidate } from "@apis/cache.ts";
import type {
	CreateTimeWindowRequest,
	TimeWindow,
} from "@features/task/types.ts";

// ==================== Time Window API Functions ====================

export const getTimeWindowsE = (
	taskId: number,
	windowType?: string,
): Promise<readonly TimeWindow[]> => {
	let endpoint = `/time-windows?task_id=${taskId}`;
	if (windowType) endpoint += `&window_type=${windowType}`;
	return cachedRequest<{ readonly items: readonly TimeWindow[] }>(
		endpoint,
		{},
	).then((r) => r.items);
};

export const createTimeWindowE = (
	data: CreateTimeWindowRequest,
): Promise<TimeWindow> =>
	request<TimeWindow>("/time-windows", {
		method: "POST",
		body: JSON.stringify(data),
	}).then((r) => tapInvalidate(CACHE.timeWindows, r));

export const deleteTimeWindowE = (id: number): Promise<void> =>
	request<void>(`/time-windows/${id}`, {
		method: "DELETE",
	}).then((r) => tapInvalidate(CACHE.timeWindows, r));
