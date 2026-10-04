// ── 任务模块 API 类型 ──

// ==================== 类型 ====================

// ── Task 基础 ──

/**
 * 任务状态。与后端 `TaskStatus` 枚举同一组取值（`src/modules/task/model.rs`）。
 *
 * 定义放在这里而不是 `lib/status-colors.ts`：那份是"状态 → 令牌名"的视觉表，
 * 而**状态本身是接口契约**（列表、日历、依赖图三处的 `status` 列都是它），
 * 归 api-types 才不会让 api 契约反过来依赖一张视觉映射表。
 */
export type TaskStatus = "backlog" | "active" | "completed" | "archived";

export interface Task {
	id: number;
	title: string;
	description: string | null;
	parent_task_id: number | null;
	status: TaskStatus;
	completed_at: string | null;
	effort_estimate_minutes: number | null;
	created_at: string;
	updated_at: string;
}

export interface CreateTaskRequest {
	title: string;
	description?: string | null;
	parent_task_id?: number | null;
	effort_estimate_minutes?: number | null;
}

export interface UpdateTaskRequest {
	title?: string;
	description?: string | null;
	parent_task_id?: number | null;
	status?: TaskStatus | null;
	effort_estimate_minutes?: number | null;
}

// ── 依赖 & 分解 ──

export interface TaskDependency {
	id: number;
	task_id: number;
	depends_on_task_id: number;
}

export interface TaskDecomposition {
	id: number;
	parent_task_id: number;
	child_task_id: number;
}

export interface TaskTimeAllocation {
	id: number;
	task_id: number;
	time_window_id: number;
	duration_minutes: number;
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
	title: string;
	start: string;
	end: string;
	window_type: string;
	status: TaskStatus;
}

// ── DAG 依赖图 ──

export interface DagNode {
	id: number;
	title: string;
	status: TaskStatus;
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

export const TaskStatus = {
	BACKLOG: "backlog",
	ACTIVE: "active",
	COMPLETED: "completed",
	ARCHIVED: "archived",
} as const;

export type TaskStatusType = (typeof TaskStatus)[keyof typeof TaskStatus];

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
