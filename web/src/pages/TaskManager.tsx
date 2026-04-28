import { Effect } from "effect";
import { createSignal, For, onMount, Show } from "solid-js";
import {
	activateTask,
	archiveTask,
	completeTask,
	createTask,
	deleteTask,
	getTasks,
	moveToBacklog,
	updateTask,
	updateTaskStatus,
} from "@/apis/taskApi";
import type { CreateTaskRequest, Task } from "@/apis/types";
import { formatDate } from "@/apis/types";
import TaskCalendar from "@/components/TaskCalendar";
import TaskList from "@/components/TaskList";
import styles from "@/styles/taskManager.module.css";

export default function TaskManager() {
	const [tasks, setTasks] = createSignal<Task[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [showCreateModal, setShowCreateModal] = createSignal(false);
	const [newTaskTitle, setNewTaskTitle] = createSignal("");
	const [newTaskDescription, setNewTaskDescription] = createSignal("");
	const [newTaskEffort, setNewTaskEffort] = createSignal<number | undefined>();

	// 加载任务
	const loadTasks = async () => {
		try {
			setLoading(true);
			const loadedTasks = await Effect.runPromise(getTasks());
			setTasks([...loadedTasks]);
		} catch (error) {
			console.error("加载任务失败:", error);
		} finally {
			setLoading(false);
		}
	};

	onMount(() => {
		loadTasks();
	});

	// 创建任务（乐观更新）
	const handleCreateTask = async (e: Event) => {
		e.preventDefault();
		const title = newTaskTitle().trim();
		if (!title) return;

		const request: CreateTaskRequest = {
			title,
			description: newTaskDescription().trim() || undefined,
			effort_estimate_minutes: newTaskEffort(),
		};

		// 乐观更新：先在本地创建一个临时任务
		const tempId = Date.now(); // 使用时间戳作为临时ID
		const tempTask: Task = {
			id: tempId,
			title: request.title,
			description: request.description ?? null,
			parent_task_id: null,
			status: "backlog",
			completed_at: null,
			effort_estimate_minutes: request.effort_estimate_minutes ?? null,
			user_id: null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};

		// 立即将临时任务添加到列表
		setTasks([...tasks(), tempTask]);

		// 清空表单并关闭模态框
		setNewTaskTitle("");
		setNewTaskDescription("");
		setNewTaskEffort(undefined);
		setShowCreateModal(false);

		try {
			// 调用 API 创建任务
			const newTask = await Effect.runPromise(createTask(request));
			// 用服务器返回的真实任务替换临时任务
			setTasks(tasks().map((t) => (t.id === tempId ? newTask : t)));
		} catch (error) {
			console.error("创建任务失败:", error);
			// 如果失败，从列表中移除临时任务
			setTasks(tasks().filter((t) => t.id !== tempId));
			// 可选：显示错误提示
			alert("创建任务失败，请重试");
		}
	};

	// 更新任务状态（乐观更新）
	const handleStatusChange = async (taskId: number, newStatus: string) => {
		// 找到当前任务
		const currentTasks = tasks();
		const taskIndex = currentTasks.findIndex((t) => t.id === taskId);
		if (taskIndex === -1) return;

		const originalTask = currentTasks[taskIndex];
		const originalStatus = originalTask.status;

		// 乐观更新：先在本地更新状态
		const updatedTasks = [...currentTasks];
		updatedTasks[taskIndex] = { ...originalTask, status: newStatus };
		setTasks(updatedTasks);

		try {
			let updatedTask: Task;
			// 根据新状态调用不同的API
			switch (newStatus) {
				case "completed":
					updatedTask = await Effect.runPromise(completeTask(taskId));
					break;
				case "active":
					updatedTask = await Effect.runPromise(activateTask(taskId));
					break;
				case "archived":
					updatedTask = await Effect.runPromise(archiveTask(taskId));
					break;
				case "backlog":
					updatedTask = await Effect.runPromise(moveToBacklog(taskId));
					break;
				default:
					throw new Error(`未知的状态: ${newStatus}`);
			}
			// 用服务器返回的数据更新
			setTasks(tasks().map((t) => (t.id === taskId ? updatedTask : t)));
		} catch (error) {
			console.error("更新任务状态失败:", error);
			// 如果失败，回滚到原来的状态
			setTasks(
				tasks().map((t) =>
					t.id === taskId ? { ...t, status: originalStatus } : t,
				),
			);
			// 可选：显示错误提示
			alert("更新任务状态失败，请重试");
		}
	};

	// 删除任务
	const handleDeleteTask = async (taskId: number) => {
		if (!confirm("确定要删除这个任务吗？")) return;

		try {
			// 乐观更新：先从列表中移除该任务
			setTasks(tasks().filter((t) => t.id !== taskId));

			// 然后调用 API
			await Effect.runPromise(deleteTask(taskId));
		} catch (error) {
			console.error("删除任务失败:", error);
			// 如果删除失败，重新加载任务列表
			loadTasks();
		}
	};

	// 更新任务（乐观更新）
	const handleUpdateTask = async (taskId: number, updates: Partial<Task>) => {
		// 找到当前任务
		const currentTasks = tasks();
		const taskIndex = currentTasks.findIndex((t) => t.id === taskId);
		if (taskIndex === -1) return;

		const originalTask = currentTasks[taskIndex];

		// 乐观更新：先在本地更新任务
		const updatedTasks = [...currentTasks];
		updatedTasks[taskIndex] = { ...originalTask, ...updates };
		setTasks(updatedTasks);

		try {
			// 调用 API 更新任务
			const updatedTask = await Effect.runPromise(updateTask(taskId, updates));
			// 用服务器返回的数据更新
			setTasks(tasks().map((t) => (t.id === taskId ? updatedTask : t)));
		} catch (error) {
			console.error("更新任务失败:", error);
			// 如果失败，回滚到原来的状态
			setTasks(tasks().map((t) => (t.id === taskId ? originalTask : t)));
			// 可选：显示错误提示
			alert("更新任务失败，请重试");
		}
	};

	return (
		<div class={styles.taskManager}>
			<div class={styles.header}>
				<h1>时间管理</h1>
				<div class={styles.actions}>
					<button
						type="button"
						class={styles.createButton}
						onClick={() => setShowCreateModal(true)}
					>
						+ 新建任务
					</button>
				</div>
			</div>

			<Show when={loading()}>
				<div class={styles.loading}>加载中...</div>
			</Show>

			<Show when={!loading()}>
				<div class={styles.splitView}>
					<TaskList
						tasks={tasks()}
						onStatusChange={handleStatusChange}
						onDelete={handleDeleteTask}
						onUpdate={handleUpdateTask}
					/>
					<div class={styles.calendarPanel}>
						<TaskCalendar tasks={tasks()} />
					</div>
				</div>
			</Show>

			<Show when={showCreateModal()}>
				<div
					class={styles.modalOverlay}
					onClick={() => setShowCreateModal(false)}
					onKeyUp={(e) => e.key === "Escape" && setShowCreateModal(false)}
					role="dialog"
					aria-modal="true"
				>
					<div
						class={styles.modal}
						onClick={(e) => e.stopPropagation()}
						onKeyUp={(e) => e.stopPropagation()}
						role="document"
					>
						<h2 class={styles.modalTitle}>创建新任务</h2>
						<form onSubmit={handleCreateTask} class={styles.form}>
							<div class={styles.formGroup}>
								<label for="task-title" class={styles.label}>
									标题 *
								</label>
								<input
									id="task-title"
									type="text"
									value={newTaskTitle()}
									onInput={(e) => setNewTaskTitle(e.currentTarget.value)}
									class={styles.input}
									required
									placeholder="输入任务标题"
								/>
							</div>

							<div class={styles.formGroup}>
								<label for="task-description" class={styles.label}>
									描述
								</label>
								<textarea
									id="task-description"
									value={newTaskDescription()}
									onInput={(e) => setNewTaskDescription(e.currentTarget.value)}
									class={styles.textarea}
									placeholder="输入任务描述"
									rows={3}
								/>
							</div>

							<div class={styles.formGroup}>
								<label for="task-effort" class={styles.label}>
									预计工时（分钟）
								</label>
								<input
									id="task-effort"
									type="number"
									value={newTaskEffort() ?? ""}
									onInput={(e) =>
										setNewTaskEffort(
											e.currentTarget.value
												? parseInt(e.currentTarget.value, 10)
												: undefined,
										)
									}
									class={styles.input}
									min="0"
									placeholder="可选"
								/>
							</div>

							<div class={styles.formActions}>
								<button
									type="button"
									onClick={() => setShowCreateModal(false)}
									class={styles.cancelButton}
								>
									取消
								</button>
								<button type="submit" class={styles.submitButton}>
									创建
								</button>
							</div>
						</form>
					</div>
				</div>
			</Show>
		</div>
	);
}
