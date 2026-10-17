// ── 任务筛选：条件、判定与 chip 文案（纯函数）──
//
// 「筛选 ⚙」面板里的全部条件都在这里，规则与 `task-group.ts` 同属一类纯函数：
// 留在组件里就只能靠肉眼验证（"p1 且未逾期"这种组合很容易写歪）。
//
// **筛选在客户端做**：任务模块本来就把全量载入内存（`TaskProvider` 的 `fetchAllTasks`，
// 个人工具规模），再加一套服务端筛选端点只会让分页与"活动条件 chip"两处状态各说各话。
//
// 空条件 = 不筛（全部命中），所以"没有 chip"永远等价于"看全部"。

import type { Task, TaskPriority, TaskStatusType } from "../api-types.ts";

export interface TaskFilter {
	/** 空 = 全部状态 */
	status: readonly TaskStatusType[];
	/** 空 = 全部标签；多条是「任一命中」 */
	tags: readonly string[];
	/** 空 = 全部优先级 */
	priority: readonly TaskPriority[];
	/** 截止范围；null = 不限 */
	dueFrom: string | null;
	dueTo: string | null;
}

export const EMPTY_FILTER: TaskFilter = {
	status: [],
	tags: [],
	priority: [],
	dueFrom: null,
	dueTo: null,
};

export function isFilterEmpty(filter: TaskFilter): boolean {
	return (
		filter.status.length === 0 &&
		filter.tags.length === 0 &&
		filter.priority.length === 0 &&
		filter.dueFrom === null &&
		filter.dueTo === null
	);
}

/** 任务是否命中全部条件（条件之间是「且」，同一条件内多值是「或」） */
export function matchesFilter(task: Task, filter: TaskFilter): boolean {
	if (filter.status.length > 0 && !filter.status.includes(task.status)) {
		return false;
	}
	if (
		filter.priority.length > 0 &&
		(task.priority === null || !filter.priority.includes(task.priority))
	) {
		// 没设优先级的任务不命中"选了 p1"——它不是 p1，不能算作命中
		return false;
	}
	if (filter.tags.length > 0) {
		const names = task.tags.map((tag) => tag.name);
		if (!filter.tags.some((tag) => names.includes(tag))) {
			return false;
		}
	}
	if (filter.dueFrom !== null || filter.dueTo !== null) {
		if (!task.due_at) {
			return false; // 选了截止范围，没填截止的任务不在范围内
		}
		const due = new Date(task.due_at).getTime();
		if (!Number.isFinite(due)) {
			return false;
		}
		if (filter.dueFrom !== null && due < new Date(filter.dueFrom).getTime()) {
			return false;
		}
		if (filter.dueTo !== null && due > new Date(filter.dueTo).getTime()) {
			return false;
		}
	}
	return true;
}

export function applyFilter(
	tasks: readonly Task[],
	filter: TaskFilter,
): Task[] {
	return isFilterEmpty(filter)
		? [...tasks]
		: tasks.filter((task) => matchesFilter(task, filter));
}

// ── 活动条件 chip ──
//
// 条件不能只"藏在面板里"：面板一关，用户就不知道列表为什么少了东西（S4-m 要求
// 活动条件以 chip 常驻按钮旁，可单个删、可清空）。

export interface FilterChip {
	/** 条件类别，删 chip 时用它改回筛选状态 */
	kind: "status" | "tag" | "priority" | "due";
	/** 具体值（多值条件下就是那一个值）；范围型条件为 null */
	value: string | null;
	label: string;
}

const STATUS_LABELS: Record<TaskStatusType, string> = {
	backlog: "待办",
	active: "进行中",
	completed: "已完成",
	archived: "已归档",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
	p1: "p1 · 最急",
	p2: "p2",
	p3: "p3",
	p4: "p4",
};

/** 活动的筛选条件 → chip 列表（渲染与"单个删除"都靠它） */
export function filterChips(filter: TaskFilter): FilterChip[] {
	const chips: FilterChip[] = [];
	for (const status of filter.status) {
		chips.push({
			kind: "status",
			value: status,
			label: `状态：${STATUS_LABELS[status]}`,
		});
	}
	for (const tag of filter.tags) {
		chips.push({ kind: "tag", value: tag, label: `标签：${tag}` });
	}
	for (const priority of filter.priority) {
		chips.push({
			kind: "priority",
			value: priority,
			label: `优先级：${PRIORITY_LABELS[priority]}`,
		});
	}
	if (filter.dueFrom !== null || filter.dueTo !== null) {
		const from = filter.dueFrom ? filter.dueFrom.slice(0, 10) : "不限";
		const to = filter.dueTo ? filter.dueTo.slice(0, 10) : "不限";
		chips.push({ kind: "due", value: null, label: `截止：${from} ~ ${to}` });
	}
	return chips;
}

/** 删掉某个 chip 后的筛选状态（范围型 chip 一次删掉整条范围） */
export function removeChip(filter: TaskFilter, chip: FilterChip): TaskFilter {
	switch (chip.kind) {
		case "status":
			return {
				...filter,
				status: filter.status.filter((v) => v !== chip.value),
			};
		case "tag":
			return { ...filter, tags: filter.tags.filter((v) => v !== chip.value) };
		case "priority":
			return {
				...filter,
				priority: filter.priority.filter((v) => v !== chip.value),
			};
		case "due":
			return { ...filter, dueFrom: null, dueTo: null };
	}
}

/** 在多值条件里增删一个值（点标签 chip / 下拉里再点一次都是这个） */
export function toggleValue<T>(values: readonly T[], value: T): T[] {
	return values.includes(value)
		? values.filter((v) => v !== value)
		: [...values, value];
}
