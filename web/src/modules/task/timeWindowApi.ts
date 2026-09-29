import { cachedRequest, domains, request } from "@shared/api";

import type { CreateTimeWindowRequest, TimeWindow } from "./api.ts";

// ==================== Time Window API Functions ====================

export const getTimeWindowsE = (
	taskId: number,
	windowType?: string,
): Promise<readonly TimeWindow[]> => {
	const typeFilter = windowType
		? `&window_type=${encodeURIComponent(windowType)}`
		: "";
	return cachedRequest<{ readonly items: readonly TimeWindow[] }>(
		`/time-windows?task_id=${taskId}${typeFilter}`,
	).then((r) => r.items);
};

export const createTimeWindowE = (
	data: CreateTimeWindowRequest,
): Promise<TimeWindow> =>
	domains.timeWindows.invalidate(
		request<TimeWindow>("/time-windows", {
			method: "POST",
			body: JSON.stringify(data),
		}),
	);

export const deleteTimeWindowE = (id: number): Promise<void> =>
	domains.timeWindows.invalidate(
		request<void>(`/time-windows/${id}`, {
			method: "DELETE",
		}),
	);
