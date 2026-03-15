import { useNavigate, useParams } from "@solidjs/router";
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
import type { TaskDetail } from "../types";

const TaskDetailPage: Component = () => {
	const params = useParams();
	const navigate = useNavigate();

	const [taskDetail, setTaskDetail] = createSignal<TaskDetail | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const taskId = () => (params.id ? parseInt(params.id, 10) : 0);

	const loadTaskDetail = async () => {
		if (!taskId()) return;

		setLoading(true);
		setError(null);

		try {
			const result = await taskApi.getTask(taskId());
			// Convert readonly arrays to mutable arrays
			const mutableResult: TaskDetail = {
				...result,
				sub_tasks: [...result.sub_tasks],
				time_windows: [...result.time_windows],
				dependencies: [...result.dependencies],
				dependents: [...result.dependents],
			};
			setTaskDetail(mutableResult);
		} catch (err) {
			setError(err instanceof Error ? err.message : "加载任务详情失败");
		} finally {
			setLoading(false);
		}
	};

	createEffect(() => {
		void loadTaskDetail();
	});

	const handleBack = () => {
		navigate("/");
	};

	const handleEdit = () => {
		navigate(`/edit/${taskId()}`);
	};

	const handleDelete = async () => {
		if (!confirm("确定要删除这个任务吗？此操作不可撤销。")) {
			return;
		}

		setLoading(true);
		setError(null);

		try {
			await taskApi.deleteTask(taskId());
			navigate("/");
		} catch (err) {
			setError(err instanceof Error ? err.message : "删除任务失败");
		} finally {
			setLoading(false);
		}
	};

	const handleViewTask = (taskId: number) => {
		navigate(`/task/${taskId}`);
	};

	const handleAddSubTask = () => {
		// TODO: Implement add subtask dialog
		alert("添加子任务功能待实现");
	};

	const handleAddDependency = () => {
		// TODO: Implement add dependency dialog
		alert("添加依赖功能待实现");
	};

	const handleAddTimeWindow = () => {
		// TODO: Implement add time window dialog
		alert("添加时间窗口功能待实现");
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

	const task = () => taskDetail()?.task;

	return (
		<div class="container">
			<Switch>
				<Match when={loading()}>
					<div class="loading">加载中...</div>
				</Match>
				<Match when={error()}>
					<div class="error">
						{error()}
						<button type="button" onClick={async () => loadTaskDetail()}>
							重试
						</button>
					</div>
				</Match>
				<Match when={!task()}>
					<div class="empty-state">
						<p>任务不存在或已被删除</p>
						<button type="button" onClick={handleBack}>
							返回任务列表
						</button>
					</div>
				</Match>
				<Match when={task()}>
					<button type="button" class="back-link" onClick={handleBack}>
						← 返回任务列表
					</button>

					<div class="header">
						<h1>{task()?.title}</h1>
						<div class="actions">
							<button type="button" onClick={() => handleEdit()}>
								编辑
							</button>
							<button
								type="button"
								class="danger"
								onClick={() => void handleDelete()}
							>
								删除
							</button>
						</div>
					</div>

					<div class="info-grid">
						<div class="info-card">
							<h3>基本信息</h3>
							<div class="info-content">
								<p>
									<span class="info-label">ID:</span> {task()?.id}
								</p>
								<p>
									<span class="info-label">标题:</span> {task()?.title}
								</p>
								<p>
									<span class="info-label">描述:</span>{" "}
									{task()?.description || "无描述"}
								</p>
								<p>
									<span class="info-label">创建时间:</span>{" "}
									{task()?.created_at
										? formatDate(task()?.created_at || "")
										: "未知"}
								</p>
							</div>
						</div>
					</div>

					<div class="section">
						<h2 class="section-title">子任务</h2>
						<Show
							when={(taskDetail()?.sub_tasks?.length || 0) > 0}
							fallback={
								<div class="empty-state">
									<p>暂无子任务</p>
									<button type="button" onClick={() => handleAddSubTask()}>
										添加子任务
									</button>
								</div>
							}
						>
							<div class="cards-grid">
								<For each={taskDetail()?.sub_tasks}>
									{(subTask) => (
										<div class="card">
											<div class="card-header">
												<h3 class="card-title">{subTask.title}</h3>
												<div class="card-actions">
													<button
														type="button"
														onClick={() => {
															handleViewTask(subTask.id);
														}}
													>
														查看
													</button>
												</div>
											</div>
											<div class="card-content">
												<p>{subTask.description || "无描述"}</p>
												<p>
													<small>
														创建时间: {formatDate(subTask.created_at)}
													</small>
												</p>
											</div>
										</div>
									)}
								</For>
							</div>
						</Show>
					</div>

					<div class="section">
						<h2 class="section-title">依赖任务</h2>
						<Show
							when={(taskDetail()?.dependencies?.length || 0) > 0}
							fallback={
								<div class="empty-state">
									<p>暂无依赖任务</p>
									<button type="button" onClick={() => handleAddDependency()}>
										添加依赖
									</button>
								</div>
							}
						>
							<div class="cards-grid">
								<For each={taskDetail()?.dependencies}>
									{(dependency) => (
										<div class="card">
											<div class="card-header">
												<h3 class="card-title">{dependency.title}</h3>
												<div class="card-actions">
													<button
														type="button"
														onClick={() => {
															handleViewTask(dependency.id);
														}}
													>
														查看
													</button>
												</div>
											</div>
											<div class="card-content">
												<p>{dependency.description || "无描述"}</p>
												<p>
													<small>
														创建时间: {formatDate(dependency.created_at)}
													</small>
												</p>
											</div>
										</div>
									)}
								</For>
							</div>
						</Show>
					</div>

					<div class="section">
						<h2 class="section-title">时间窗口</h2>
						<Show
							when={(taskDetail()?.time_windows?.length || 0) > 0}
							fallback={
								<div class="empty-state">
									<p>暂无时间窗口</p>
									<button type="button" onClick={() => handleAddTimeWindow()}>
										分配时间窗口
									</button>
								</div>
							}
						>
							<div class="cards-grid">
								<For each={taskDetail()?.time_windows}>
									{(timeWindow) => (
										<div class="card">
											<div class="card-header">
												<h3 class="card-title">时间窗口 #{timeWindow.id}</h3>
											</div>
											<div class="card-content">
												<div class="time-window-item">
													<div class="time-window-dates">
														<div>
															<span class="date-label">开始:</span>
															{formatDate(timeWindow.starts_at)}
														</div>
														<div>
															<span class="date-label">结束:</span>
															{formatDate(timeWindow.ends_at)}
														</div>
													</div>
												</div>
											</div>
										</div>
									)}
								</For>
							</div>
						</Show>
					</div>

					<div class="relationship-actions">
						<button type="button" onClick={() => handleAddSubTask()}>
							添加子任务
						</button>
						<button type="button" onClick={() => handleAddDependency()}>
							添加依赖
						</button>
						<button type="button" onClick={() => handleAddTimeWindow()}>
							分配时间窗口
						</button>
					</div>
				</Match>
			</Switch>
		</div>
	);
};

export default TaskDetailPage;
