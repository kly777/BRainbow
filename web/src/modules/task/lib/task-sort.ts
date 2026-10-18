import type { TaskSortKey } from "../api.ts";

/** 首页与 /task 共用的排序选项（值必须覆盖 TaskSortKey） */
export const TASK_SORT_OPTIONS: readonly {
	value: TaskSortKey;
	label: string;
}[] = [
	{ value: "smart", label: "智能排序" },
	{ value: "due", label: "按截止" },
	{ value: "priority", label: "按优先级" },
	{ value: "effort", label: "按工时" },
	{ value: "created", label: "按创建" },
];
