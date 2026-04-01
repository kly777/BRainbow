import { useNavigate } from "@solidjs/router";
import {
	type Component,
	createEffect,
	createSignal,
	For,
	Match,
	Show,
	Switch,
} from "solid-js";
import { taskApi } from "@/apis";
import type { Task } from "@/apis/types";
import styles from "@/styles/tasks/taskList.module.css";

const TaskListPage: Component = () => {
	const navigate = useNavigate();
	const [tasks, setTasks] = createSignal<Task[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [searchQuery, setSearchQuery] = createSignal("");
	const [currentPage, setCurrentPage] = createSignal(1);
	const pageSize = 10;

	const loadTasks = async () => {
		setLoading(true);
		setError(null);

		try {
			const result = await taskApi.getTasks(searchQuery().trim());
			setTasks(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : "加载列表失败");
		} finally {
			setLoading(false);
		}
	};

	createEffect(() => {
		void loadTasks();
	});

	const handleSearch = (_event: Event) => {
		if (_event.target instanceof HTMLInputElement) {
			setSearchQuery(_event.target.value);
			setCurrentPage(1);
		}
	};

	const handleCreateTask = () => {
		navigate("/t/create");
	};

	const handleViewTask = (taskId: number) => {
		navigate(`/t/${taskId}`);
	};

	const handleEditTask = (taskId: number) => {
		navigate(`/t/edit/${taskId}`);
	};

	const handleDeleteTask = async (taskId: number) => {
		if (!confirm("确定要删除这个项目吗？此操作不可撤销。")) {
			return;
		}

		try {
			await taskApi.deleteTask(taskId);
			setTasks(tasks().filter((task) => task.id !== taskId));
		} catch (err) {
			setError(err instanceof Error ? err.message : "删除失败");
		}
	};

	const totalPages = () => Math.ceil(tasks().length / pageSize);
	const paginatedTasks = () => {
		const startIndex = (currentPage() - 1) * pageSize;
		const endIndex = startIndex + pageSize;
		return tasks().slice(startIndex, endIndex);
	};

	const handlePreviousPage = () => {
		if (currentPage() > 1) {
			setCurrentPage(currentPage() - 1);
		}
	};

	const handleNextPage = () => {
		if (currentPage() < totalPages()) {
			setCurrentPage(currentPage() + 1);
		}
	};

	const formatDate = (dateString: string): string => {
		try {
			const date = new Date(dateString);
			return date.toLocaleDateString("zh-CN", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch {
			return dateString;
		}
	};

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<h1>结构管理</h1>
				<div class={styles.actions}>
					<button
						type="button"
						class={styles.primaryButton}
						onClick={handleCreateTask}
					>
						新建项目
					</button>
					<button
						type="button"
						class={styles.secondaryButton}
						onClick={async () => loadTasks()}
					>
						刷新
					</button>
				</div>
			</div>

			<div class={styles.searchSection}>
				<input
					type="text"
					class={styles.searchInput}
					placeholder="搜索项目标题..."
					value={searchQuery()}
					onInput={handleSearch}
				/>
			</div>

			<Show when={error()}>
				<div class={styles.error}>{error()}</div>
			</Show>

			<Switch>
				<Match when={loading()}>
					<div class={styles.loading}>加载中...</div>
				</Match>
				<Match when={tasks().length === 0}>
					<div class={styles.emptyState}>
						<p>{searchQuery() ? "没有找到匹配的任务" : "暂无任务数据"}</p>
						<Show when={!searchQuery()}>
							<button
								type="button"
								class={styles.primaryButton}
								onClick={handleCreateTask}
							>
								创建第一个任务
							</button>
						</Show>
					</div>
				</Match>
				<Match when={true}>
					<table class={styles.tasksTable}>
						<thead>
							<tr>
								<th>ID</th>
								<th>标题</th>
								<th>描述</th>
								<th>创建时间</th>
								<th>操作</th>
							</tr>
						</thead>
						<tbody>
							<For each={paginatedTasks()}>
								{(task) => (
									<tr>
										<td>{task.id}</td>
										<td>
											<button
												type="button"
												class={styles.taskTitle}
												onClick={() => {
													handleViewTask(task.id);
												}}
											>
												{task.title}
											</button>
										</td>
										<td>
											<div
												class={styles.taskDescription}
												title={task.description || ""}
											>
												{task.description || "无描述"}
											</div>
										</td>
										<td class={styles.createdAt}>
											{formatDate(task.created_at)}
										</td>
										<td>
											<div class={styles.taskActions}>
												<button
													type="button"
													class={styles.primaryButton}
													onClick={() => {
														handleViewTask(task.id);
													}}
												>
													查看
												</button>
												<button
													type="button"
													class={styles.secondaryButton}
													onClick={() => {
														handleEditTask(task.id);
													}}
												>
													编辑
												</button>
												<button
													type="button"
													class={styles.deleteButton}
													onClick={() => {
														void handleDeleteTask(task.id);
													}}
												>
													删除
												</button>
											</div>
										</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>

					<Show when={totalPages() > 1}>
						<div class={styles.pagination}>
							<button
								type="button"
								class={styles.secondaryButton}
								onClick={handlePreviousPage}
								disabled={currentPage() === 1}
							>
								上一页
							</button>

							<span class={styles.paginationInfo}>
								第 {currentPage()} 页，共 {totalPages()} 页
							</span>
							<button
								type="button"
								class={styles.secondaryButton}
								onClick={handleNextPage}
								disabled={currentPage() === totalPages()}
							>
								下一页
							</button>
						</div>
					</Show>
				</Match>
			</Switch>
		</div>
	);
};

export default TaskListPage;
