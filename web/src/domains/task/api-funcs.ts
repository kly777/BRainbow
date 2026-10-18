// ── 任务 API 函数 ──

import type { PaginatedResponse } from "@shared/api";
import { buildQuery, cachedRequest } from "@shared/api";
import type { CalendarEvent, Task, TaskSortKey } from "./api-types.ts";

// ==================== Task API Functions ====================

/** 后端 `page_size` 硬上限（`src/shared/pagination.rs` 的 MAX_PAGE_SIZE） */
export const MAX_PAGE_SIZE = 100;

/** 拉全时的页数上限：个人工具用不到，只用来挡住异常循环 */
const MAX_ALL_PAGES = 10;

interface CalendarEventApi extends Omit<CalendarEvent, "end"> {
	end: string | null;
}

export const getCalendarEventsE = (
	start?: string,
	end?: string,
	status?: string,
): Promise<readonly CalendarEvent[]> => {
	return cachedRequest<readonly CalendarEventApi[]>(
		`/tasks/calendar${buildQuery({ start, end, status })}`,
	).then((items) =>
		items.map((event) => ({
			...event,
			// 软计划点没有结束时刻：给 15 分钟占位，日历仍能画出一小段。
			end:
				event.end ??
				new Date(new Date(event.start).getTime() + 15 * 60_000).toISOString(),
		})),
	);
};

export const getTasksE = (
	page = 1,
	pageSize = MAX_PAGE_SIZE,
	sort: TaskSortKey = "smart",
): Promise<PaginatedResponse<Task>> =>
	cachedRequest(`/tasks${buildQuery({ page, page_size: pageSize, sort })}`);

export const getAllTasksE = (
	page = 1,
	pageSize = MAX_PAGE_SIZE,
): Promise<PaginatedResponse<Task>> =>
	cachedRequest(`/tasks/all${buildQuery({ page, page_size: pageSize })}`);

/**
 * 取全量任务：列表、看板、依赖图、父子选择器要的都是**完整集合**，而 `/tasks` 是
 * 分页接口（后端缺省 `page_size=20`）—— 早先只取第一页，于是第 21 条起在界面上
 * 根本不存在（开发库当时就有 33 条任务，列表只显示 20 条）。
 *
 * 逐页取到 `total` 为止（每页用后端上限），最多 `MAX_ALL_PAGES` 页；仍取不全时
 * `truncated` 为真，由调用点提示，而不是静默少显示。
 *
 * @param fetchPage 取某页的函数：列表用 `getTasksE`（缺省），含归档的用 `getAllTasksE`
 */
export async function fetchAllTasks(
	fetchPage: (
		page: number,
		pageSize: number,
	) => Promise<PaginatedResponse<Task>> = getTasksE,
): Promise<{ items: Task[]; total: number; truncated: boolean }> {
	const items: Task[] = [];
	let total = 0;
	for (let page = 1; page <= MAX_ALL_PAGES; page += 1) {
		const res = await fetchPage(page, MAX_PAGE_SIZE);
		total = res.total;
		items.push(...res.items);
		// 空页也停：后端在 page 越界时回空数组，继续请求没有意义
		if (res.items.length === 0 || items.length >= total) break;
	}
	return { items, total, truncated: items.length < total };
}
