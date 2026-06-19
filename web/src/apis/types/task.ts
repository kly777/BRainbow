import type { TimeWindow } from "./time_window.ts";

// ── Task 基础 ──

export interface Task {
	id: number;
	title: string;
	description: string | null;
	parent_task_id: number | null;
	status: string;
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
	status?: string | null;
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
	status: string;
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
