import { Effect } from "effect";
import { createSignal, onMount, Show } from "solid-js";
import {
	createTask,
	getAllTasks,
	getTaskStats,
	getTasks,
	searchTasks,
} from "@/apis/taskApi";
import {
	type CreateTaskRequest,
	getErrorMessage,
	type Task,
} from "@/apis/types";
import TaskCalendar from "@/components/TaskCalendar";
import TaskList from "@/components/TaskList";
import { useTaskActions } from "@/hooks/useTaskActions";
import styles from "./TaskManager.module.css";

export default function TaskManager() {
	const [tasks, setTasks] = createSignal<Task[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [showCreateModal, setShowCreateModal] = createSignal(false);
	const [newTaskTitle, setNewTaskTitle] = createSignal("");
	const [newTaskDescription, setNewTaskDescription] = createSignal("");
	const [newTaskEffort, setNewTaskEffort] = createSignal<number | undefined>();
	const [searchQuery, setSearchQuery] = createSignal("");
	const [stats, setStats] = createSignal({
		backlog: 0,
		active: 0,
		completed: 0,
		archived: 0,
	});
	const [quickTitle, setQuickTitle] = createSignal("");
	const [activeFilter, setActiveFilter] = createSignal("all");

	// 加载任务
	const loadTasks = async () => {
		try {
			setLoading(true);
			const loadedTasks = await Effect.runPromise(getTasks());
			setTasks([...loadedTasks]);

			// 加载统计
			try {
				const result = await Effect.runPromise(getTaskStats());
				setStats(result);
			} catch (e) {
				console.error("获取统计失败:", e);
				alert(`获取统计失败: ${getErrorMessage(e)}`);
			}
		} catch (error) {
			console.error("加载任务失败:", error);
			alert(`加载任务失败: ${getErrorMessage(error)}`);
		} finally {
			setLoading(false);
		}
	};

	onMount(() => {
		loadTasks();
	});

	// 搜索任务
	const handleSearch = async () => {
		const q = searchQuery().trim();
		if (!q) {
			loadTasks();
			return;
		}
		try {
			setLoading(true);
			const results = await Effect.runPromise(searchTasks(q));
			setTasks([...results]);
		} catch (error) {
			console.error("搜索任务失败:", error);
			alert(`搜索任务失败: ${getErrorMessage(error)}`);
		} finally {
			setLoading(false);
		}
	};

	// 筛选任务
	const filterByStatus = async (status: string) => {
		setActiveFilter(status);
		// setLoading(true);
		try {
			let results: readonly Task[];
			switch (status) {
				case "backlog":
					results = await Effect.runPromise(getTasks());
					break;
				case "active":
					results = await Effect.runPromise(getTasks());
					break;
				case "completed":
					results = await Effect.runPromise(getTasks());
					break;
				default:
					results = await Effect.runPromise(getAllTasks());
			}
			// 根据状态客户端过滤
			setTasks([...results.filter((t) => t.status === status)]);
		} catch (error) {
			console.error("筛选失败:", error);
			alert(`筛选失败: ${getErrorMessage(error)}`);
		} finally {
			// setLoading(false);
		}
	};

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
			const msg = getErrorMessage(error);
			console.error("创建任务失败:", msg);
			// 如果失败，从列表中移除临时任务
			setTasks(tasks().filter((t) => t.id !== tempId));
			// 可选：显示错误提示
			alert(`创建任务失败: ${msg}`);
		}
	};

	const {
		handleStatusChange,
		handleDelete: handleDeleteTask,
		handleUpdateTask,
		handleAddSubTask,
	} = useTaskActions(tasks, setTasks, loadTasks);

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

			<div class={styles.searchBar}>
				<input
					type="text"
					placeholder="搜索任务标题..."
					value={searchQuery()}
					onInput={(e) => setSearchQuery(e.currentTarget.value)}
					onKeyDown={(e) => e.key === "Enter" && handleSearch()}
					class={styles.searchInput}
				/>
				<button
					type="button"
					onClick={handleSearch}
					class={styles.searchButton}
				>
					搜索
				</button>
			</div>

			<div class={styles.statsGrid}>
				<div class={styles.statCard}>
					<div class={styles.statValue}>{stats().backlog}</div>
					<div class={styles.statLabel}>待办</div>
				</div>
				<div class={styles.statCard}>
					<div class={styles.statValue}>{stats().active}</div>
					<div class={styles.statLabel}>进行中</div>
				</div>
				<div class={styles.statCard}>
					<div class={styles.statValue}>{stats().completed}</div>
					<div class={styles.statLabel}>已完成</div>
				</div>
				<div class={styles.statCard}>
					<div class={styles.statValue}>{stats().archived}</div>
					<div class={styles.statLabel}>已归档</div>
				</div>
			</div>

			<div class={styles.quickCreate}>
				<input
					type="text"
					placeholder="快速创建任务，按Enter..."
					value={quickTitle()}
					onInput={(e) => setQuickTitle(e.currentTarget.value)}
					onKeyDown={async (e) => {
						if (e.key === "Enter" && quickTitle().trim()) {
							const title = quickTitle().trim();
							setQuickTitle("");
							try {
								const task = await Effect.runPromise(createTask({ title }));
								setTasks([task, ...tasks()]);
							} catch (error) {
								console.error("快速创建失败:", error);
								alert(`快速创建失败: ${getErrorMessage(error)}`);
							}
						}
					}}
					class={styles.quickInput}
				/>
			</div>

			<div class={styles.filterBar}>
				<button
					type="button"
					class={`${styles.filterBtn} ${activeFilter() === "all" ? styles.filterActive : ""}`}
					onClick={() => {
						setActiveFilter("all");
						loadTasks();
					}}
				>
					全部
				</button>
				<button
					type="button"
					class={`${styles.filterBtn} ${activeFilter() === "backlog" ? styles.filterActive : ""}`}
					onClick={() => filterByStatus("backlog")}
				>
					待办
				</button>
				<button
					type="button"
					class={`${styles.filterBtn} ${activeFilter() === "active" ? styles.filterActive : ""}`}
					onClick={() => filterByStatus("active")}
				>
					进行中
				</button>
				<button
					type="button"
					class={`${styles.filterBtn} ${activeFilter() === "completed" ? styles.filterActive : ""}`}
					onClick={() => filterByStatus("completed")}
				>
					已完成
				</button>
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
						onAddSubTask={handleAddSubTask}
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
