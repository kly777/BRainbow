import { cachedRequest, domains, patch, request } from "@shared/api";

import type { CreateTimeWindowRequest, TimeWindow } from "./api.ts";

// ── 时间块的 API 适配层 ──
//
// 后端已把 `time_window` 换成 `task_block`（`/tasks/{id}/blocks`）。日历、建议、
// 抽屉这些旧调用点仍按 `TimeWindow` 的字段说话；这里做**一处**形状映射，
// 不在每个组件里改字段名。

interface TaskBlockApi {
	id: number;
	task_id: number;
	kind: "feasible" | "planned";
	start_at: string;
	end_at: string | null;
	fixed: boolean;
	source: string;
}

const toWindow = (block: TaskBlockApi): TimeWindow => ({
	id: block.id,
	start_time: block.start_at,
	end_time: block.end_at,
	window_type: block.kind,
	task_id: block.task_id,
	user_id: null,
});

const toBlockBody = (data: Partial<CreateTimeWindowRequest>) => ({
	...(data.window_type ? { kind: data.window_type } : {}),
	...(data.start_time ? { start_at: data.start_time } : {}),
	...(data.end_time !== undefined ? { end_at: data.end_time } : {}),
});

export const getTimeWindowsE = (
	taskId: number,
	windowType?: string,
): Promise<readonly TimeWindow[]> =>
	cachedRequest<readonly TaskBlockApi[]>(`/tasks/${taskId}/blocks`).then(
		(items) =>
			items
				.filter((block) => !windowType || block.kind === windowType)
				.map(toWindow),
	);

export const createTimeWindowE = (
	data: CreateTimeWindowRequest,
): Promise<TimeWindow> =>
	domains.timeWindows.invalidate(
		request<TaskBlockApi>(`/tasks/${data.task_id}/blocks`, {
			method: "POST",
			body: JSON.stringify({
				kind: data.window_type,
				start_at: data.start_time,
				end_at: data.end_time,
			}),
		}).then(toWindow),
	);

/**
 * 改时间块（拖拽落位 / 键盘改时间都走它）。
 *
 * 后端 PATCH 支持只带部分字段，所以拖动只需要发起止两端 —— 时长与类型不变。
 */
export const updateTimeWindowE = (
	id: number,
	data: Partial<CreateTimeWindowRequest>,
): Promise<TimeWindow> =>
	domains.timeWindows.invalidate(
		patch<TaskBlockApi>(`/tasks/blocks/${id}`, toBlockBody(data)).then(
			toWindow,
		),
		{
			entity: `/tasks/blocks/${id}`,
		},
	);

export const deleteTimeWindowE = (id: number): Promise<void> =>
	domains.timeWindows.invalidate(
		request<void>(`/tasks/blocks/${id}`, {
			method: "DELETE",
		}),
	);
