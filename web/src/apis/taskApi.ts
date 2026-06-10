import { request } from "./request.ts";
import {
    type ApiErrorType,
    type CalendarEvent,
    type CreateTaskRequest,
    type DagView,
    type Task,
    type TaskDetail,
    type UpdateTaskRequest,
} from "./types/index.ts";

// ==================== Task API Functions ====================

export const getCalendarEvents = (
    start?: string,
    end?: string,
    status?: string,
): Promise<readonly CalendarEvent[]> => {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (status) params.set("status", status);
    const qs = params.toString();
    return request(
        `/tasks/calendar${qs ? `?${qs}` : ""}`,
        {},
    );
};

export const getTasks = () =>
    request("/tasks", {});

export const getAllTasks = () =>
    request("/tasks/all", {});

// ==================== Tree API ====================

export interface TreeNode {
    readonly task: Task;
    readonly children: readonly TreeNode[];
}

export const getTaskTree = (): Promise<readonly TreeNode[]> =>
    request("/tasks/tree", {});

export const getTaskDetail = (
    id: number,
): Promise<TaskDetail> =>
    request(`/tasks/${id}/detail`, {});

export const createTask = (
    task: CreateTaskRequest,
): Promise<Task> =>
    request("/tasks", {
        method: "POST",
        body: JSON.stringify(task),
    });

export const updateTask = (
    id: number,
    task: UpdateTaskRequest,
): Promise<Task> =>
    request(`/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(task),
    });

export const deleteTask = (id: number): Promise<void> =>
    request(`/tasks/${id}`, {
        method: "DELETE",
    });

export const addTaskDependency = (
    taskId: number,
    dependsOnTaskId: number,
): Promise<void> =>
    request(`/tasks/${taskId}/dependencies`, {
        method: "POST",
        body: JSON.stringify({ depends_on_task_id: dependsOnTaskId }),
    });

export const removeTaskDependency = (
    taskId: number,
    dependsOnTaskId: number,
): Promise<void> =>
    request(`/tasks/${taskId}/dependencies/${dependsOnTaskId}`, {
        method: "DELETE",
    });

export const addTaskDecomposition = (
    parentTaskId: number,
    childTaskId: number,
): Promise<void> =>
    request(
        `/tasks/${parentTaskId}/decomposition/${childTaskId}`,
        {
            method: "POST",
        },
    );

export const addTaskTimeAllocation = (
    taskId: number,
    timeWindowId: number,
    durationMinutes: number,
): Promise<void> =>
    request(
        `/tasks/${taskId}/time-allocation/${timeWindowId}/${durationMinutes}`,
        {
            method: "POST",
        },
    );

export const getUserTasks = (
    userId: number,
): Promise<readonly Task[]> =>
    request(`/tasks/user/${userId}`, {});

export const updateTaskStatus = (
    id: number,
    status: string,
): Promise<Task> =>
    request(`/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
    });

export const searchTasks = (query: string) =>
    request(
        `/tasks/search?q=${encodeURIComponent(query)}`,
        {},
    );

export const getBacklogTasks = () =>
    request("/tasks/status/backlog", {});

export const getActiveTasks = () =>
    request("/tasks/status/active", {});

export const getCompletedTasks = () =>
    request("/tasks/status/completed", {});

export const getArchivedTasks = () =>
    request("/tasks/status/archived", {});

export const getTaskStats = (): Promise<{
    backlog: number;
    active: number;
    completed: number;
    archived: number;
}> => request(
    "/tasks/stats",
    {},
);

// 任务状态操作
export const completeTask = (id: number): Promise<Task> =>
    request(`/tasks/${id}/complete`, {
        method: "POST",
    });

export const activateTask = (id: number): Promise<Task> =>
    request(`/tasks/${id}/activate`, {
        method: "POST",
    });

export const archiveTask = (id: number): Promise<Task> =>
    request(`/tasks/${id}/archive`, {
        method: "POST",
    });

export const moveToBacklog = (id: number): Promise<Task> =>
    request(`/tasks/${id}/move-to-backlog`, {
        method: "POST",
    });

// ==================== DAG API ====================

export const getDag = (
    taskId?: number,
    depth?: number,
): Promise<DagView> => {
    const params = new URLSearchParams();
    if (taskId) params.set("task_id", String(taskId));
    if (depth) params.set("depth", String(depth));
    const qs = params.toString();
    return request(`/tasks/dag${qs ? `?${qs}` : ""}`, {});
};
