import { type Effect, Schema } from "effect";
import { request } from "./request.ts";
import {
    type ApiErrorType,
    type CalendarEvent,
    CalendarEventSchema,
    type CreateTaskRequest,
    type DagView,
    DagViewSchema,
    PaginatedSchema,
    type Task,
    type TaskDetail,
    TaskDetailSchema,
    TaskSchema,
    type UpdateTaskRequest,
} from "./types/index.ts";

// ==================== Task API Functions ====================

export const getCalendarEvents = (
    start?: string,
    end?: string,
    status?: string,
): Effect.Effect<readonly CalendarEvent[], ApiErrorType> => {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (status) params.set("status", status);
    const qs = params.toString();
    return request(
        `/tasks/calendar${qs ? `?${qs}` : ""}`,
        Schema.Array(CalendarEventSchema),
        {},
    );
};

export const getTasks = () =>
    request("/tasks", PaginatedSchema(TaskSchema), {});

export const getAllTasks = () =>
    request("/tasks/all", PaginatedSchema(TaskSchema), {});

// ==================== Tree API ====================

/** Recursive tree node schema for task hierarchy */
const TreeNodeSchema = Schema.Struct({
    task: TaskSchema,
    children: Schema.Array(
        Schema.suspend(
            (): Schema.Schema<TreeNode> =>
                TreeNodeSchema as unknown as Schema.Schema<TreeNode>,
        ),
    ),
}) as unknown as Schema.Schema<TreeNode>;

export { TreeNodeSchema };

export interface TreeNode {
    readonly task: Task;
    readonly children: readonly TreeNode[];
}

export const getTaskTree = (): Effect.Effect<
    readonly TreeNode[],
    ApiErrorType
> => request("/tasks/tree", Schema.Array(TreeNodeSchema), {});

export const getTaskDetail = (
    id: number,
): Effect.Effect<TaskDetail, ApiErrorType> =>
    request(`/tasks/${id}/detail`, TaskDetailSchema, {});

export const createTask = (
    task: CreateTaskRequest,
): Effect.Effect<Task, ApiErrorType> =>
    request("/tasks", TaskSchema, {
        method: "POST",
        body: JSON.stringify(task),
    });

export const updateTask = (
    id: number,
    task: UpdateTaskRequest,
): Effect.Effect<Task, ApiErrorType> =>
    request(`/tasks/${id}`, TaskSchema, {
        method: "PATCH",
        body: JSON.stringify(task),
    });

export const deleteTask = (id: number): Effect.Effect<void, ApiErrorType> =>
    request(`/tasks/${id}`, Schema.Void, {
        method: "DELETE",
    });

export const addTaskDependency = (
    taskId: number,
    dependsOnTaskId: number,
): Effect.Effect<void, ApiErrorType> =>
    request(`/tasks/${taskId}/dependencies`, Schema.Void, {
        method: "POST",
        body: JSON.stringify({ depends_on_task_id: dependsOnTaskId }),
    });

export const removeTaskDependency = (
    taskId: number,
    dependsOnTaskId: number,
): Effect.Effect<void, ApiErrorType> =>
    request(`/tasks/${taskId}/dependencies/${dependsOnTaskId}`, Schema.Void, {
        method: "DELETE",
    });

export const addTaskDecomposition = (
    parentTaskId: number,
    childTaskId: number,
): Effect.Effect<void, ApiErrorType> =>
    request(
        `/tasks/${parentTaskId}/decomposition/${childTaskId}`,
        Schema.Void,
        {
            method: "POST",
        },
    );

export const addTaskTimeAllocation = (
    taskId: number,
    timeWindowId: number,
    durationMinutes: number,
): Effect.Effect<void, ApiErrorType> =>
    request(
        `/tasks/${taskId}/time-allocation/${timeWindowId}/${durationMinutes}`,
        Schema.Void,
        {
            method: "POST",
        },
    );

export const getUserTasks = (
    userId: number,
): Effect.Effect<readonly Task[], ApiErrorType> =>
    request(`/tasks/user/${userId}`, Schema.Array(TaskSchema), {});

export const updateTaskStatus = (
    id: number,
    status: string,
): Effect.Effect<Task, ApiErrorType> =>
    request(`/tasks/${id}`, TaskSchema, {
        method: "PATCH",
        body: JSON.stringify({ status }),
    });

export const searchTasks = (query: string) =>
    request(
        `/tasks/search?q=${encodeURIComponent(query)}`,
        PaginatedSchema(TaskSchema),
        {},
    );

export const getBacklogTasks = () =>
    request("/tasks/status/backlog", PaginatedSchema(TaskSchema), {});

export const getActiveTasks = () =>
    request("/tasks/status/active", PaginatedSchema(TaskSchema), {});

export const getCompletedTasks = () =>
    request("/tasks/status/completed", PaginatedSchema(TaskSchema), {});

export const getArchivedTasks = () =>
    request("/tasks/status/archived", PaginatedSchema(TaskSchema), {});

export const getTaskStats = (): Effect.Effect<
    {
        backlog: number;
        active: number;
        completed: number;
        archived: number;
    },
    ApiErrorType
> => request(
    "/tasks/stats",
    Schema.Struct({
        backlog: Schema.Number,
        active: Schema.Number,
        completed: Schema.Number,
        archived: Schema.Number,
    }),
    {},
);

// 任务状态操作
export const completeTask = (id: number): Effect.Effect<Task, ApiErrorType> =>
    request(`/tasks/${id}/complete`, TaskSchema, {
        method: "POST",
    });

export const activateTask = (id: number): Effect.Effect<Task, ApiErrorType> =>
    request(`/tasks/${id}/activate`, TaskSchema, {
        method: "POST",
    });

export const archiveTask = (id: number): Effect.Effect<Task, ApiErrorType> =>
    request(`/tasks/${id}/archive`, TaskSchema, {
        method: "POST",
    });

export const moveToBacklog = (id: number): Effect.Effect<Task, ApiErrorType> =>
    request(`/tasks/${id}/move-to-backlog`, TaskSchema, {
        method: "POST",
    });

// ==================== DAG API ====================

export const getDag = (
    taskId?: number,
    depth?: number,
): Effect.Effect<DagView, ApiErrorType> => {
    const params = new URLSearchParams();
    if (taskId) params.set("task_id", String(taskId));
    if (depth) params.set("depth", String(depth));
    const qs = params.toString();
    return request(`/tasks/dag${qs ? `?${qs}` : ""}`, DagViewSchema, {});
};
