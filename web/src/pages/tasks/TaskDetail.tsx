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
import { taskApi } from "@/api";
import AddDependencyModal from "@/components/AddDependencyModal";
import AddSubTaskModal from "@/components/AddSubTaskModal";
import AddTimeWindowModal from "@/components/AddTimeWindowModal";
import styles from "@/styles/tasks/taskDetail.module.css";
import type { TaskDetail } from "@/types";

const TaskDetailPage: Component = () => {
	const params = useParams();
	const navigate = useNavigate();

	const [taskDetail, setTaskDetail] = createSignal<TaskDetail | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	// Modal states
	const [showAddSubTaskModal, setShowAddSubTaskModal] = createSignal(false);
	const [showAddDependencyModal, setShowAddDependencyModal] =
		createSignal(false);
	const [showAddTimeWindowModal, setShowAddTimeWindowModal] =
		createSignal(false);

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
		navigate("/t");
	};

	const handleEdit = () => {
		navigate(`/t/edit/${taskId()}`);
	};

	const handleDelete = async () => {
		if (!confirm("确定要删除这个任务吗？此操作不可撤销。")) {
			return;
		}

		setLoading(true);
		setError(null);

		try {
			await taskApi.deleteTask(taskId());
			navigate("/t");
		} catch (err) {
			setError(err instanceof Error ? err.message : "删除任务失败");
		} finally {
			setLoading(false);
		}
	};

	const handleViewTask = (taskId: number) => {
		navigate(`/t/${taskId}`);
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

	// Modal handlers
	const handleAddSubTask = () => {
		setShowAddSubTaskModal(true);
	};

	const handleAddDependency = () => {
		setShowAddDependencyModal(true);
	};

	const handleAddTimeWindow = () => {
		setShowAddTimeWindowModal(true);
	};

	const handleModalSuccess = () => {
		// 重新加载任务详情
		void loadTaskDetail();
	};

	return (
		<>
			<div class={styles.container}>
				<Switch>
					<Match when={loading()}>
						<div class={styles.loading}>加载中...</div>
					</Match>
					<Match when={error()}>
						<div class={styles.error}>
							{error()}
							<button type="button" onClick={async () => loadTaskDetail()}>
								重试
							</button>
						</div>
					</Match>
					<Match when={!task()}>
						<div class={styles.emptyState}>
							<p>任务不存在或已被删除</p>
							<button
								type="button"
								class={styles.primaryButton}
								onClick={handleBack}
							>
								返回任务列表
							</button>
						</div>
					</Match>
					<Match when={task()}>
						<button type="button" class={styles.backLink} onClick={handleBack}>
							← 返回任务列表
						</button>

						<div class={styles.taskHeader}>
							<h1>{task()?.title}</h1>
							<div class={styles.headerActions}>
								<button
									type="button"
									class={styles.primaryButton}
									onClick={() => handleEdit()}
								>
									编辑
								</button>
								<button
									type="button"
									class={styles.dangerButton}
									onClick={() => void handleDelete()}
								>
									删除
								</button>
							</div>
						</div>

						<div class={styles.taskInfo}>
							<div class={styles.infoContent}>
								<p>
									<span class={styles.infoLabel}>ID:</span> {task()?.id}
								</p>
								<p>
									<span class={styles.infoLabel}>标题:</span> {task()?.title}
								</p>
								<p>
									<span class={styles.infoLabel}>描述:</span>{" "}
									{task()?.description || "无描述"}
								</p>
								<p>
									<span class={styles.infoLabel}>创建时间:</span>{" "}
									{task()?.created_at
										? formatDate(task()?.created_at || "")
										: "未知"}
								</p>
							</div>
						</div>

						<div class={styles.section}>
							<h2 class={styles.sectionTitle}>子任务</h2>
							<Show
								when={(taskDetail()?.sub_tasks?.length || 0) > 0}
								fallback={
									<div class={styles.emptyState}>
										<p>暂无子任务</p>
										<button
											type="button"
											class={styles.primaryButton}
											onClick={() => handleAddSubTask()}
										>
											添加子任务
										</button>
									</div>
								}
							>
								<div class={styles.cardsGrid}>
									<For each={taskDetail()?.sub_tasks}>
										{(subTask) => (
											<div class={styles.card}>
												<div class={styles.cardHeader}>
													<h3 class={styles.cardTitle}>{subTask.title}</h3>
													<div class={styles.cardActions}>
														<button
															type="button"
															class={styles.primaryButton}
															onClick={() => {
																handleViewTask(subTask.id);
															}}
														>
															查看
														</button>
													</div>
												</div>
												<div class={styles.cardBody}>
													<p>{subTask.description || "无描述"}</p>
													<p class={styles.cardMeta}>
														创建时间: {formatDate(subTask.created_at)}
													</p>
												</div>
											</div>
										)}
									</For>
								</div>
							</Show>
						</div>

						<div class={styles.section}>
							<h2 class={styles.sectionTitle}>依赖任务</h2>
							<Show
								when={(taskDetail()?.dependencies?.length || 0) > 0}
								fallback={
									<div class={styles.emptyState}>
										<p>暂无依赖任务</p>
										<button
											type="button"
											class={styles.primaryButton}
											onClick={() => handleAddDependency()}
										>
											添加依赖
										</button>
									</div>
								}
							>
								<div class={styles.cardsGrid}>
									<For each={taskDetail()?.dependencies}>
										{(dependency) => (
											<div class={styles.card}>
												<div class={styles.cardHeader}>
													<h3 class={styles.cardTitle}>{dependency.title}</h3>
													<div class={styles.cardActions}>
														<button
															type="button"
															class={styles.primaryButton}
															onClick={() => {
																handleViewTask(dependency.id);
															}}
														>
															查看
														</button>
													</div>
												</div>
												<div class={styles.cardBody}>
													<p>{dependency.description || "无描述"}</p>
													<p class={styles.cardMeta}>
														创建时间: {formatDate(dependency.created_at)}
													</p>
												</div>
											</div>
										)}
									</For>
								</div>
							</Show>
						</div>

						<div class={styles.section}>
							<h2 class={styles.sectionTitle}>时间窗口</h2>
							<Show
								when={(taskDetail()?.time_windows?.length || 0) > 0}
								fallback={
									<div class={styles.emptyState}>
										<p>暂无时间窗口</p>
										<button
											type="button"
											class={styles.primaryButton}
											onClick={() => handleAddTimeWindow()}
										>
											分配时间窗口
										</button>
									</div>
								}
							>
								<div class={styles.cardsGrid}>
									<For each={taskDetail()?.time_windows}>
										{(timeWindow) => (
											<div class={`${styles.card} ${styles.timeWindowCard}`}>
												<div class={styles.timeWindowHeader}>
													<h3 class={styles.timeWindowTitle}>
														时间窗口 #{timeWindow.id}
													</h3>
												</div>
												<div class={styles.cardBody}>
													<div class={styles.timeWindowTime}>
														<div>
															<span class={styles.infoLabel}>开始:</span>
															{formatDate(timeWindow.starts_at)}
														</div>
														<div>
															<span class={styles.infoLabel}>结束:</span>
															{formatDate(timeWindow.ends_at)}
														</div>
													</div>
												</div>
											</div>
										)}
									</For>
								</div>
							</Show>
						</div>

						<div class={styles.relationshipActions}>
							<button
								type="button"
								class={styles.primaryButton}
								onClick={handleAddSubTask}
							>
								添加子任务
							</button>
							<button
								type="button"
								class={styles.primaryButton}
								onClick={handleAddDependency}
							>
								添加依赖
							</button>
							<button
								type="button"
								class={styles.primaryButton}
								onClick={handleAddTimeWindow}
							>
								分配时间窗口
							</button>
						</div>
					</Match>
				</Switch>
			</div>

			<AddSubTaskModal
				isOpen={showAddSubTaskModal()}
				onClose={() => setShowAddSubTaskModal(false)}
				onSuccess={handleModalSuccess}
				taskId={taskId()}
				currentSubTasks={taskDetail()?.sub_tasks || []}
			/>

			<AddDependencyModal
				isOpen={showAddDependencyModal()}
				onClose={() => setShowAddDependencyModal(false)}
				onSuccess={handleModalSuccess}
				taskId={taskId()}
				currentDependencies={taskDetail()?.dependencies || []}
			/>

			<AddTimeWindowModal
				isOpen={showAddTimeWindowModal()}
				onClose={() => setShowAddTimeWindowModal(false)}
				onSuccess={handleModalSuccess}
				taskId={taskId()}
				currentTimeWindows={taskDetail()?.time_windows || []}
			/>
		</>
	);
};

export default TaskDetailPage;
