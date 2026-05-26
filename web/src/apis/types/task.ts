import { Schema } from "effect";
import { TimeWindowSchema, type TimeWindow } from "./time_window.ts";

// ── Task 基础 ──

export const TaskSchema = Schema.Struct({
    id: Schema.Number,
    title: Schema.String,
    description: Schema.NullOr(Schema.String),
    parent_task_id: Schema.NullOr(Schema.Number),
    status: Schema.String,
    completed_at: Schema.NullOr(Schema.String),
    effort_estimate_minutes: Schema.NullOr(Schema.Number),
    created_at: Schema.String,
    updated_at: Schema.String,
});

export const CreateTaskRequestSchema = Schema.Struct({
    title: Schema.String,
    description: Schema.optional(Schema.NullOr(Schema.String)),
    parent_task_id: Schema.optional(Schema.NullOr(Schema.Number)),
    effort_estimate_minutes: Schema.optional(Schema.NullOr(Schema.Number)),
});

export const UpdateTaskRequestSchema = Schema.Struct({
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.NullOr(Schema.String)),
    parent_task_id: Schema.optional(Schema.NullOr(Schema.Number)),
    status: Schema.optional(Schema.NullOr(Schema.String)),
    effort_estimate_minutes: Schema.optional(Schema.NullOr(Schema.Number)),
});

export type Task = Schema.Schema.Type<typeof TaskSchema>;
export type CreateTaskRequest = Schema.Schema.Type<typeof CreateTaskRequestSchema>;
export type UpdateTaskRequest = Schema.Schema.Type<typeof UpdateTaskRequestSchema>;

// ── 依赖 & 分解 ──

export const TaskDependencySchema = Schema.Struct({
    id: Schema.Number,
    task_id: Schema.Number,
    depends_on_task_id: Schema.Number,
});

export const TaskDecompositionSchema = Schema.Struct({
    id: Schema.Number,
    parent_task_id: Schema.Number,
    child_task_id: Schema.Number,
});

export const TaskTimeAllocationSchema = Schema.Struct({
    id: Schema.Number,
    task_id: Schema.Number,
    time_window_id: Schema.Number,
    duration_minutes: Schema.Number,
});

export type TaskDependency = Schema.Schema.Type<typeof TaskDependencySchema>;
export type TaskDecomposition = Schema.Schema.Type<typeof TaskDecompositionSchema>;
export type TaskTimeAllocation = Schema.Schema.Type<typeof TaskTimeAllocationSchema>;

// ── TaskDetail ──

export const TaskDetailSchema = Schema.Struct({
    task: TaskSchema,
    depends_on: Schema.Array(Schema.Number),
    children: Schema.Array(TaskSchema),
    available_slots: Schema.Array(
        Schema.suspend((): Schema.Schema<TimeWindow> =>
            TimeWindowSchema as unknown as Schema.Schema<TimeWindow>,
        ),
    ),
    planned_slots: Schema.Array(
        Schema.suspend((): Schema.Schema<TimeWindow> =>
            TimeWindowSchema as unknown as Schema.Schema<TimeWindow>,
        ),
    ),
    actual_slots: Schema.Array(
        Schema.suspend((): Schema.Schema<TimeWindow> =>
            TimeWindowSchema as unknown as Schema.Schema<TimeWindow>,
        ),
    ),
});

export type TaskDetail = Schema.Schema.Type<typeof TaskDetailSchema>;

// ── Calendar Event ──

export const CalendarEventSchema = Schema.Struct({
    task_id: Schema.Number,
    title: Schema.String,
    start: Schema.String,
    end: Schema.String,
    window_type: Schema.String,
    status: Schema.String,
});

export type CalendarEvent = Schema.Schema.Type<typeof CalendarEventSchema>;

// ── DAG 依赖图 ──

export const DagNodeSchema = Schema.Struct({
    id: Schema.Number,
    title: Schema.String,
    status: Schema.String,
});

export const DagEdgeSchema = Schema.Struct({
    from: Schema.Number,
    to: Schema.Number,
});

export const DagViewSchema = Schema.Struct({
    nodes: Schema.Array(DagNodeSchema),
    edges: Schema.Array(DagEdgeSchema),
});

export type DagNode = Schema.Schema.Type<typeof DagNodeSchema>;
export type DagEdge = Schema.Schema.Type<typeof DagEdgeSchema>;
export type DagView = Schema.Schema.Type<typeof DagViewSchema>;

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
        case "backlog": return "待办";
        case "active": return "进行中";
        case "completed": return "已完成";
        case "archived": return "已归档";
        default: return "未知";
    }
}
