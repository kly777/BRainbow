import { request } from "./request.ts";
import type {
    CalendarEvent,
    CreateTaskRequest,
    DagView,
    Task,
    TaskDetail,
    UpdateTaskRequest,
} from "./types/index.ts";

// ==================== 类型 ====================

export interface TaskListResponse {
    items: Task[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
}

// ==================== Task API Functions ====================

export const getCalendarEventsE = (
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

export const getTasksE = (): Promise<TaskListResponse> =>
    request("/tasks", {});

export const getAllTasksE = (): Promise<TaskListResponse> =>
    request("/tasks/all", {});

// ==================== Tree API ====================

export interface TreeNode {
    readonly task: Task;
    readonly children: readonly TreeNode[];
}

export const getTaskTreeE = (): Promise<readonly TreeNode[]> =>
    request("/tasks/tree", {});

export const getTaskDetailE = (
    id: number,
): Promise<TaskDetail> =>
    request(`/tasks/${id}/detail`, {});

export const createTaskE = (
    task: CreateTaskRequest,
): Promise<Task> =>
    request("/tasks", {
        method: "POST",
        body: JSON.stringify(task),
    });

export const updateTaskE = (
    id: number,
    task: UpdateTaskRequest,
): Promise<Task> =>
    request(`/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(task),
    });

export const deleteTaskE = (id: number): Promise<void> =>
    request(`/tasks/${id}`, {
        method: "DELETE",
    });

export const addTaskDependencyE = (
    taskId: number,
    dependsOnTaskId: number,
): Promise<void> =>
    request(`/tasks/${taskId}/dependencies`, {
        method: "POST",
        body: JSON.stringify({ depends_on_task_id: dependsOnTaskId }),
    });

export const removeTaskDependencyE = (
    taskId: number,
    dependsOnTaskId: number,
): Promise<void> =>
    request(`/tasks/${taskId}/dependencies/${dependsOnTaskId}`, {
        method: "DELETE",
    });

export const addTaskDecompositionE = (
    parentTaskId: number,
    childTaskId: number,
): Promise<void> =>
    request(
        `/tasks/${parentTaskId}/decomposition/${childTaskId}`,
        {
            method: "POST",
        },
    );

export const addTaskTimeAllocationE = (
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

export const getUserTasksE = (
    userId: number,
): Promise<readonly Task[]> =>
    request(`/tasks/user/${userId}`, {});

export const updateTaskStatusE = (
    id: number,
    status: string,
): Promise<Task> =>
    request(`/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
    });

export const searchTasksE = (query: string): Promise<TaskListResponse> =>
    request(
        `/tasks/search?q=${encodeURIComponent(query)}`,
        {},
    );

export const getBacklogTasksE = (): Promise<TaskListResponse> =>
    request("/tasks/status/backlog", {});

export const getActiveTasksE = (): Promise<TaskListResponse> =>
    request("/tasks/status/active", {});

export const getCompletedTasksE = (): Promise<TaskListResponse> =>
    request("/tasks/status/completed", {});

export const getArchivedTasksE = (): Promise<TaskListResponse> =>
    request("/tasks/status/archived", {});

export const getTaskStatsE = (): Promise<{
    backlog: number;
    active: number;
    completed: number;
    archived: number;
}> => request(
    "/tasks/stats",
    {},
);

// 任务状态操作
export const completeTaskE = (id: number): Promise<Task> =>
    request(`/tasks/${id}/complete`, {
        method: "POST",
    });

export const activateTaskE = (id: number): Promise<Task> =>
    request(`/tasks/${id}/activate`, {
        method: "POST",
    });

export const archiveTaskE = (id: number): Promise<Task> =>
    request(`/tasks/${id}/archive`, {
        method: "POST",
    });

export const moveToBacklogE = (id: number): Promise<Task> =>
    request(`/tasks/${id}/move-to-backlog`, {
        method: "POST",
    });

// ==================== DAG API ====================

export const getDagE = (
    taskId?: number,
    depth?: number,
): Promise<DagView> => {
    const params = new URLSearchParams();
    if (taskId) params.set("task_id", String(taskId));
    if (depth) params.set("depth", String(depth));
    const qs = params.toString();
    return request(`/tasks/dag${qs ? `?${qs}` : ""}`, {});
};
