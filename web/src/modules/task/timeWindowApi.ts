import { CACHE, cachedRequest, request, withInvalidate } from "@shared/api";
import type { CreateTimeWindowRequest, TimeWindow } from "./api.ts";

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
	withInvalidate(
		CACHE.timeWindows,
		request<TimeWindow>("/time-windows", {
			method: "POST",
			body: JSON.stringify(data),
		}),
	);

export const deleteTimeWindowE = (id: number): Promise<void> =>
	withInvalidate(
		CACHE.timeWindows,
		request<void>(`/time-windows/${id}`, {
			method: "DELETE",
		}),
	);
