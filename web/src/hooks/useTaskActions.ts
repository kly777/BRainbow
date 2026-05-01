import { type Accessor, type Setter } from "solid-js";
import { Effect } from "effect";
import {
    createTask,
    completeTask,
    activateTask,
    archiveTask,
    moveToBacklog,
    deleteTask,
    updateTask,
} from "@/apis/taskApi";
import { getErrorMessage, type CreateTaskRequest, type Task } from "@/apis/types";

export function useTaskActions(
    getTasks: Accessor<Task[]>,
    setTasks: Setter<Task[]>,
    reload: () => Promise<void>,
) {
    const handleStatusChange = async (taskId: number, newStatus: string) => {
        const currentTasks = getTasks();
        const taskIndex = currentTasks.findIndex((t) => t.id === taskId);
        if (taskIndex === -1) return;

        const originalTask = currentTasks[taskIndex];
        const originalStatus = originalTask.status;

        // 乐观更新
        const updatedTasks = [...currentTasks];
        updatedTasks[taskIndex] = { ...originalTask, status: newStatus };
        setTasks(updatedTasks);

        try {
            switch (newStatus) {
                case "completed":
                    await Effect.runPromise(completeTask(taskId));
                    break;
                case "active":
                    await Effect.runPromise(activateTask(taskId));
                    break;
                case "archived":
                    await Effect.runPromise(archiveTask(taskId));
                    break;
                case "backlog":
                    await Effect.runPromise(moveToBacklog(taskId));
                    break;
                default:
                    throw new Error(`未知的状态: ${newStatus}`);
            }
            // 服务端确认后重载
            await reload();
        } catch (error) {
            const msg = getErrorMessage(error);
            console.error("更新任务状态失败:", msg);
            // 回滚
            setTasks(
                getTasks().map((t) =>
                    t.id === taskId ? { ...t, status: originalStatus } : t,
                ),
            );
            alert(`更新任务状态失败: ${msg}`);
        }
    };

    const handleDelete = async (taskId: number) => {
        if (!confirm("确定要删除这个任务吗？")) return;

        // 乐观更新
        setTasks(getTasks().filter((t) => t.id !== taskId));

        try {
            await Effect.runPromise(deleteTask(taskId));
        } catch (error) {
            const msg = getErrorMessage(error);
            console.error("删除任务失败:", msg);
            alert(`删除任务失败: ${msg}`);
            await reload();
        }
    };

    const handleUpdateTask = async (taskId: number, updates: Partial<Task>) => {
        const currentTasks = getTasks();
        const taskIndex = currentTasks.findIndex((t) => t.id === taskId);
        if (taskIndex === -1) return;

        const originalTask = currentTasks[taskIndex];

        // 乐观更新
        const updatedTasks = [...currentTasks];
        updatedTasks[taskIndex] = { ...originalTask, ...updates };
        setTasks(updatedTasks);

        try {
            await Effect.runPromise(updateTask(taskId, updates));
            await reload();
        } catch (error) {
            const msg = getErrorMessage(error);
            console.error("更新任务失败:", msg);
            setTasks(getTasks().map((t) => (t.id === taskId ? originalTask : t)));
            alert(`更新任务失败: ${msg}`);
        }
    };

    const handleAddSubTask = async (parentId: number, title: string) => {
        try {
            const request: CreateTaskRequest = { title, parent_task_id: parentId };
            const newTask = await Effect.runPromise(createTask(request));
            setTasks([...getTasks(), newTask]);
        } catch (error) {
            const msg = getErrorMessage(error);
            console.error("创建子任务失败:", msg);
            alert(`创建子任务失败: ${msg}`);
        }
    };

    return {
        handleStatusChange,
        handleDelete,
        handleUpdateTask,
        handleAddSubTask,
    };
}
