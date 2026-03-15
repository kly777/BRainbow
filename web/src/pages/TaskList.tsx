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
import { taskApi } from "../api";
import type { Task } from "../types";

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
			setError(err instanceof Error ? err.message : "加载任务列表失败");
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
		navigate("/create");
	};

	const handleViewTask = (taskId: number) => {
		navigate(`/task/${taskId}`);
	};

	const handleEditTask = (taskId: number) => {
		navigate(`/edit/${taskId}`);
	};

	const handleDeleteTask = async (taskId: number) => {
		if (!confirm("确定要删除这个任务吗？此操作不可撤销。")) {
			return;
		}

		try {
			await taskApi.deleteTask(taskId);
			setTasks(tasks().filter((task) => task.id !== taskId));
		} catch (err) {
			setError(err instanceof Error ? err.message : "删除任务失败");
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
		<div class="container">
			<div class="header">
				<h1>任务列表</h1>
				<div class="actions">
					<button type="button" onClick={handleCreateTask}>
						创建新任务
					</button>
					<button
						type="button"
						class="secondary"
						onClick={async () => loadTasks()}
					>
						刷新
					</button>
				</div>
			</div>

			<div class="search-box">
				<input
					type="text"
					class="search-input"
					placeholder="搜索任务标题..."
					value={searchQuery()}
					onInput={handleSearch}
				/>
			</div>

			<Show when={error()}>
				<div class="error">{error()}</div>
			</Show>

			<Switch>
				<Match when={loading()}>
					<div class="loading">加载中...</div>
				</Match>
				<Match when={tasks().length === 0}>
					<div class="empty-state">
						<p>{searchQuery() ? "没有找到匹配的任务" : "暂无任务数据"}</p>
						<Show when={!searchQuery()}>
							<button type="button" onClick={handleCreateTask}>
								创建第一个任务
							</button>
						</Show>
					</div>
				</Match>
				<Match when={true}>
					<table class="tasks-table">
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
												class="task-title"
												onClick={() => {
													handleViewTask(task.id);
												}}
											>
												{task.title}
											</button>
										</td>
										<td>
											<div
												class="task-description"
												title={task.description || ""}
											>
												{task.description || "无描述"}
											</div>
										</td>
										<td class="created-at">{formatDate(task.created_at)}</td>
										<td>
											<div class="task-actions">
												<button
													type="button"
													onClick={() => {
														handleViewTask(task.id);
													}}
												>
													查看
												</button>
												<button
													type="button"
													class="secondary"
													onClick={() => {
														handleEditTask(task.id);
													}}
												>
													编辑
												</button>
												<button
													type="button"
													class="delete"
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
						<div class="pagination">
							<button
								type="button"
								onClick={handlePreviousPage}
								disabled={currentPage() === 1}
							>
								上一页
							</button>

							<span class="pagination-info">
								第 {currentPage()} 页，共 {totalPages()} 页
							</span>
							<button
								type="button"
								onClick={handleNextPage}
								disabled={currentPage() === totalPages()}
							>
								下一页
							</button>
						</div>
					</Show>

					<div class="stats">
						<div class="stat-item">
							<div class="stat-value">{tasks().length}</div>
							<div class="stat-label">总任务数</div>
						</div>
						<div class="stat-item">
							<div class="stat-value">{pageSize}</div>
							<div class="stat-label">每页显示</div>
						</div>
						<div class="stat-item">
							<div class="stat-value">{totalPages()}</div>
							<div class="stat-label">总页数</div>
						</div>
					</div>
				</Match>
			</Switch>
		</div>
	);
};

export default TaskListPage;
