// ── task 的数据适配器 ──
//
// view 不直接 import api.ts：详情、保存、子任务、删除、标签搜索都从这里走。
// 后续切换 transport 或加离线层时，只需要改这一处。

import type { UpdateTaskRequest } from "../api.ts";
import {
	createTaskE,
	deleteTaskE,
	getTagsE,
	getTaskDetailE,
	updateTaskE,
} from "../api.ts";

export const taskRepository = {
	detail: (id: number) => getTaskDetailE(id),
	update: (id: number, request: UpdateTaskRequest) => updateTaskE(id, request),
	createChild: (parentId: number, title: string) =>
		createTaskE({ title, parent_task_id: parentId }),
	remove: (id: number) => deleteTaskE(id),
	tags: (prefix: string) => getTagsE(prefix),
};
