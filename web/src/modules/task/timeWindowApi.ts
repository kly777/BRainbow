import { cachedRequest, request, resource } from "@shared/api";

const timeWindows = resource("timeWindows");

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
	timeWindows.invalidate(
		request<TimeWindow>("/time-windows", {
			method: "POST",
			body: JSON.stringify(data),
		}),
	);

export const deleteTimeWindowE = (id: number): Promise<void> =>
	timeWindows.invalidate(
		request<void>(`/time-windows/${id}`, {
			method: "DELETE",
		}),
	);
