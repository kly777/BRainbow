import { cachedRequest, domains, patch, request } from "@shared/api";

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

/**
 * 改时间窗（拖拽落位 / 键盘改时间都走它）。
 *
 * 后端 PATCH 支持只带部分字段，所以拖动只需要发起止两端 —— 时长与类型不变。
 */
export const updateTimeWindowE = (
	id: number,
	data: Partial<CreateTimeWindowRequest>,
): Promise<TimeWindow> =>
	domains.timeWindows.invalidate(
		patch<TimeWindow>(`/time-windows/${id}`, data),
		{
			entity: `/time-windows/${id}`,
		},
	);

export const deleteTimeWindowE = (id: number): Promise<void> =>
	domains.timeWindows.invalidate(
		request<void>(`/time-windows/${id}`, {
			method: "DELETE",
		}),
	);
