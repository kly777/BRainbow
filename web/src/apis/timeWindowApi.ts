import { request } from "./request.ts";
import {
    type CreateTimeWindowRequest,
    type TimeWindow,
} from "./types/index.ts";

// ==================== Time Window API Functions ====================

export const getTimeWindows = (
    taskId: number,
    windowType?: string,
): Promise<readonly TimeWindow[]> => {
    let endpoint = `/time-windows?task_id=${taskId}`;
    if (windowType) endpoint += `&window_type=${windowType}`;
    return request<{ readonly items: readonly TimeWindow[] }>(endpoint, {}).then(
        (r) => r.items,
    );
};

export const createTimeWindow = (
    data: CreateTimeWindowRequest,
): Promise<TimeWindow> =>
    request<TimeWindow>("/time-windows", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const deleteTimeWindow = (
    id: number,
): Promise<void> =>
    request<void>(`/time-windows/${id}`, {
        method: "DELETE",
    });
