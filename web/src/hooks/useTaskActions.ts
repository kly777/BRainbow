import { Effect } from "effect";
import type { Accessor, Setter } from "solid-js";
import {
	activateTask,
	archiveTask,
	completeTask,
	createTask,
	deleteTask,
	moveToBacklog,
	updateTask,
} from "@/apis/taskApi";
import { type CreateTaskRequest, getErrorMessage, type Task } from "@/apis/types";

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
			await reload();
		} catch (error) {
			// 全局层已 toast，组件只做回滚
			console.error("更新任务状态失败:", getErrorMessage(error));
			setTasks(
				getTasks().map((t) =>
					t.id === taskId ? { ...t, status: originalStatus } : t,
				),
			);
		}
	};

	const handleDelete = async (taskId: number) => {
		if (!confirm("确定要删除这个任务吗？")) return;

		// 乐观移除
		const current = getTasks();
		setTasks(current.filter((t) => t.id !== taskId));

		try {
			await Effect.runPromise(deleteTask(taskId));
		} catch (error) {
			console.error("删除任务失败:", getErrorMessage(error));
			await reload(); // 全局已 toast，组件只恢复数据
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
			console.error("更新任务失败:", getErrorMessage(error));
			// 全局已 toast，组件只回滚
			setTasks(getTasks().map((t) => (t.id === taskId ? originalTask : t)));
		}
	};

	const handleAddSubTask = async (parentId: number, title: string) => {
		try {
			const request: CreateTaskRequest = { title, parent_task_id: parentId };
			const newTask = await Effect.runPromise(createTask(request));
			setTasks([...getTasks(), newTask]);
		} catch (error) {
			console.error("创建子任务失败:", getErrorMessage(error));
			// 全局已 toast + 回滚由 createTask 调用方处理
		}
	};

	return {
		handleStatusChange,
		handleDelete,
		handleUpdateTask,
		handleAddSubTask,
	};
}
