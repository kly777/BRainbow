import { type Effect, Schema } from "effect";
import { request } from "./request.ts";
import {
	type ApiErrorType,
	type CreateTimeWindowRequest,
	type TimeWindow,
	TimeWindowSchema,
} from "./types/index.ts";

// ==================== Time Window API Functions ====================

export const getTimeWindows = (
	taskId: number,
	windowType?: string,
): Effect.Effect<readonly TimeWindow[], ApiErrorType> => {
	let endpoint = `/time-windows?task_id=${taskId}`;
	if (windowType) endpoint += `&window_type=${windowType}`;
	return request(endpoint, Schema.Array(TimeWindowSchema), {});
};

export const createTimeWindow = (
	data: CreateTimeWindowRequest,
): Effect.Effect<TimeWindow, ApiErrorType> =>
	request("/time-windows", TimeWindowSchema, {
		method: "POST",
		body: JSON.stringify(data),
	});

export const deleteTimeWindow = (
	id: number,
): Effect.Effect<void, ApiErrorType> =>
	request(`/time-windows/${id}`, Schema.Void, {
		method: "DELETE",
	});
