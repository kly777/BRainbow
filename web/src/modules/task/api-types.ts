// ── 任务模块 API 类型 ──

// ==================== 类型 ====================

// ── Task 基础 ──

export type TaskStatusType = "backlog" | "active" | "completed" | "archived";

/** 优先级：p1 最急；`null` = 用户没表达过（与显式 p3 不同） */
export type TaskPriority = "p1" | "p2" | "p3" | "p4";

/**
 * 列表排序口径。**默认 smart**：系统算"先做哪件"，每条带理由。
 *
 * `created` 仍在选项里（"我就想按录入时间看"是正当需求），但它不再是系统兜底 ——
 * 排序算崩了要修排序，不是退回旧口径。
 */
export type TaskSortKey = "smart" | "due" | "created" | "priority" | "effort";

export interface Tag {
	id: number;
	name: string;
}

export interface Task {
	id: number;
	title: string;
	description: string | null;
	parent_task_id: number | null;
	/** 联合类型而非裸 string：链路上的 switch 漏分支会在编译期报出来 */
	status: TaskStatusType;
	completed_at: string | null;
	effort_estimate_minutes: number | null;
	/** 开始时间（软偏好）；"2026-10-03T15:00:00+00:00" */
	start_at: string | null;
	/** 截止时间（承诺） */
	due_at: string | null;
	priority: TaskPriority | null;
	tags: Tag[];
	/** 排序理由（人话，一行）；只有 `sort=smart` 的列表会带 */
	reason?: string;
	/** 理由的分项；smart 排序下恒非空（P8） */
	reasons?: string[];
	created_at: string;
	updated_at: string;
}

export interface CreateTaskRequest {
	title: string;
	description?: string | null;
	parent_task_id?: number | null;
	effort_estimate_minutes?: number | null;
	start_at?: string | null;
	due_at?: string | null;
	priority?: TaskPriority | null;
	tags?: string[];
	/**
	 * 初始 `planned` 时段：一次请求建任务 + 窗口，不留"任务建了但没排上"的半成功态。
	 *
	 * 只在"日历上点空白新建"那条路径用（用户自己点的，不违反"系统不自动落位"）；
	 * 拖动已有的窗口走 PATCH。
	 */
	planned_window?: { start: string; end: string };
}

/**
 * 部分更新。可空字段是**双层语义**：字段缺席 = 不改，显式 `null` = 清空
 * （后端用 `double_option` 反序列化，两种写法含义不同）。
 */
export interface UpdateTaskRequest {
	title?: string;
	description?: string | null;
	parent_task_id?: number | null;
	status?: TaskStatusType | null;
	effort_estimate_minutes?: number | null;
	start_at?: string | null;
	due_at?: string | null;
	priority?: TaskPriority | null;
	tags?: string[];
}

// ── 依赖 & 分解 ──

export interface TaskDependency {
	id: number;
	task_id: number;
	depends_on_task_id: number;
}

// ── TaskDetail ──

export interface TaskDetail {
	task: Task;
	depends_on: number[];
	children: Task[];
	available_slots: TimeWindow[];
	planned_slots: TimeWindow[];
	actual_slots: TimeWindow[];
}

// ── Calendar Event ──

export interface CalendarEvent {
	task_id: number;
	/** 时间窗自身的 id —— 拖拽落位要 PATCH 这条记录 */
	window_id: number;
	title: string;
	start: string;
	end: string;
	window_type: string;
	status: TaskStatusType;
	/** 优先级（日历按 type/status/priority 三通道上色 —— 形状与文字也承载信息，不只靠颜色） */
	priority: TaskPriority | null;
	/** 截止时间（与这条时段的 planned 窗口是两回事：`⚠` 逾期徽标靠它算） */
	due_at: string | null;
}

// ── DAG 依赖图 ──

export interface DagNode {
	id: number;
	title: string;
	status: string;
}

export interface DagEdge {
	from: number;
	to: number;
}

export interface DagView {
	nodes: DagNode[];
	edges: DagEdge[];
}

// ── 时间窗口 ──

export interface TimeWindow {
	id: number;
	start_time: string;
	end_time: string;
	window_type: string;
	task_id: number;
	user_id: number | null;
}

export interface CreateTimeWindowRequest {
	start_time: string;
	end_time: string;
	window_type: string;
	task_id: number;
	user_id?: number | null;
}

// ── 常量 & 展示 ──

/** 状态常量（值即联合类型的成员，改一处两处一起走） */
export const TaskStatus = {
	BACKLOG: "backlog",
	ACTIVE: "active",
	COMPLETED: "completed",
	ARCHIVED: "archived",
} as const satisfies Record<string, TaskStatusType>;

/**
 * 运行期把关：DOM 控件给的 value 是裸字符串，非成员值回落到 backlog。
 *
 * 编译期收紧（联合类型）与运行期兜底（这里）是两件事，都要有：前者挡新代码漏分支，
 * 后者挡库里的脏值（历史数据里的未知 status 不该让一条任务从界面上消失）。
 */
export function toTaskStatus(value: string): TaskStatusType {
	switch (value) {
		case "active":
		case "completed":
		case "archived":
			return value;
		default:
			return "backlog";
	}
}

export function getStatusText(status: string): string {
	switch (status) {
		case "backlog":
			return "待办";
		case "active":
			return "进行中";
		case "completed":
			return "已完成";
		case "archived":
			return "已归档";
		default:
			return "未知";
	}
}

// TaskListResponse 已移除，使用 PaginatedResponse<Task> 代替（来自 @shared/api）
