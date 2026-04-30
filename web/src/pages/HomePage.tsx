import { A, useNavigate } from "@solidjs/router";
import { Effect } from "effect";
import { createSignal, For, onMount, Show } from "solid-js";
import Card, { type CardData } from "@/components/Card";
import TaskList from "@/components/TaskList";
import {
	getTasks,
	getTaskStats,
	createTask,
	completeTask,
	activateTask,
	moveToBacklog,
	deleteTask,
	updateTask,
} from "@/apis/taskApi";
import { getCards, deleteCard as apiDeleteCard } from "@/apis/cardApi";
import { getErrorMessage, type CreateTaskRequest, type Task } from "@/apis/types";
import styles from "./HomePage.module.css"

// 主页组件
const HomePage = () => {
	const navigate = useNavigate();
	// 任务列表状态
	const [todos, setTodos] = createSignal<Task[]>([]);
	// 最近创建的card状态
	const [recentCards, setRecentCards] = createSignal<CardData[]>([]);
	// 加载状态
	const [loading, setLoading] = createSignal(true);

	// 新Todo输入状态
	const [newTodoTitle, setNewTodoTitle] = createSignal("");
	const [newTodoDescription, setNewTodoDescription] = createSignal("");

	// 统计信息
	const [stats, setStats] = createSignal({
		totalTasks: 0,
		completedTasks: 0,
		pendingTasks: 0,
		totalCards: 0,
	});

	// 加载所有数据
	const loadData = async () => {
		try {
			setLoading(true);

			// 并行加载任务、统计和卡片
			const [allTasks, taskStats, cards] = await Promise.all([
				Effect.runPromise(getTasks()),
				Effect.runPromise(getTaskStats()),
				Effect.runPromise(getCards()),
			]);

			setTodos([...allTasks]);

			// 按 updated_at 降序排列，取前4个
			const sortedCards = [...cards].sort(
				(a, b) =>
					new Date(b.updated_at).getTime() -
					new Date(a.updated_at).getTime(),
			);
			setRecentCards(sortedCards.slice(0, 4));

			// 使用后端统计 API
			setStats({
				totalTasks: taskStats.backlog + taskStats.active + taskStats.completed + taskStats.archived,
				completedTasks: taskStats.completed,
				pendingTasks: taskStats.backlog + taskStats.active,
				totalCards: cards.length,
			});
		} catch (error) {
			console.error("加载数据失败:", error);
			alert(`加载数据失败: ${getErrorMessage(error)}`);
		} finally {
			setLoading(false);
		}
	};

	onMount(() => {
		loadData();
	});

	// 添加新Todo（乐观更新）
	const addTodo = async () => {
		if (!newTodoTitle().trim()) return;

		const request: CreateTaskRequest = {
			title: newTodoTitle().trim(),
			description: newTodoDescription().trim() || undefined,
		};

		// 乐观更新：先在本地创建一个临时任务
		const tempId = Date.now();
		const tempTask: Task = {
			id: tempId,
			title: request.title,
			description: request.description ?? null,
			parent_task_id: null,
			status: "backlog",
			completed_at: null,
			effort_estimate_minutes: null,
			user_id: null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};

		// 立即将临时任务添加到列表
		setTodos([tempTask, ...todos()]);

		// 更新本地统计
		setStats((prev) => ({
			...prev,
			totalTasks: prev.totalTasks + 1,
			pendingTasks: prev.pendingTasks + 1,
		}));

		// 清空表单
		setNewTodoTitle("");
		setNewTodoDescription("");

		try {
			// 调用 API 创建任务
			const newTask = await Effect.runPromise(createTask(request));
			// 用服务器返回的真实任务替换临时任务
			setTodos(todos().map((t) => (t.id === tempId ? newTask : t)));
		} catch (error) {
			const msg = getErrorMessage(error);
			console.error("创建任务失败:", msg);
			// 如果失败，从列表中移除临时任务并恢复统计
			setTodos(todos().filter((t) => t.id !== tempId));
			setStats((prev) => ({
				...prev,
				totalTasks: prev.totalTasks - 1,
				pendingTasks: prev.pendingTasks - 1,
			}));
			alert(`创建任务失败: ${msg}`);
		}
	};

	// 切换任务状态（乐观更新）
	const handleStatusChange = async (taskId: number, newStatus: string) => {
		const currentTodos = todos();
		const taskIndex = currentTodos.findIndex((t) => t.id === taskId);
		if (taskIndex === -1) return;

		const originalTask = currentTodos[taskIndex];
		const originalStatus = originalTask.status;

		// 乐观更新：先在本地更新状态
		setTodos(
			currentTodos.map((t) =>
				t.id === taskId ? { ...t, status: newStatus } : t,
			),
		);

		try {
			switch (newStatus) {
				case "completed":
					await Effect.runPromise(completeTask(taskId));
					break;
				case "active":
					await Effect.runPromise(activateTask(taskId));
					break;
				case "backlog":
					await Effect.runPromise(moveToBacklog(taskId));
					break;
				case "archived":
					await Effect.runPromise(deleteTask(taskId));
					break;
			}
			// 重新加载以获取最新数据
			loadData();
		} catch (error) {
			const msg = getErrorMessage(error);
			console.error("更新任务状态失败:", msg);
			// 回滚
			setTodos(
				currentTodos.map((t) =>
					t.id === taskId ? { ...t, status: originalStatus } : t,
				),
			);
			alert(`更新任务状态失败: ${msg}`);
		}
	};

	// 删除任务（乐观更新）
	const handleDelete = async (taskId: number) => {
		if (!confirm("确定要删除这个任务吗？")) return;

		const task = todos().find((t) => t.id === taskId);
		const wasCompleted = task?.status === "completed";

		// 乐观更新：先从列表中移除
		setTodos(todos().filter((t) => t.id !== taskId));
		setStats((prev) => ({
			...prev,
			totalTasks: prev.totalTasks - 1,
			completedTasks: wasCompleted
				? prev.completedTasks - 1
				: prev.completedTasks,
			pendingTasks: !wasCompleted
				? prev.pendingTasks - 1
				: prev.pendingTasks,
		}));

		try {
			await Effect.runPromise(deleteTask(taskId));
		} catch (error) {
			console.error("删除任务失败:", error);
			alert(`删除任务失败: ${getErrorMessage(error)}`);
			loadData();
		}
	};

	// 更新任务（乐观更新）
	const handleUpdateTask = async (taskId: number, updates: Partial<Task>) => {
		const currentTodos = todos();
		const taskIndex = currentTodos.findIndex((t) => t.id === taskId);
		if (taskIndex === -1) return;

		const originalTask = currentTodos[taskIndex];

		// 乐观更新
		setTodos(
			currentTodos.map((t) =>
				t.id === taskId ? { ...t, ...updates } : t,
			),
		);

		try {
			await Effect.runPromise(updateTask(taskId, updates));
			loadData();
		} catch (error) {
			const msg = getErrorMessage(error);
			console.error("更新任务失败:", msg);
			setTodos(
				currentTodos.map((t) =>
					t.id === taskId ? originalTask : t,
				),
			);
			alert(`更新任务失败: ${msg}`);
		}
	};

	// 创建子任务
	const handleAddSubTask = async (parentId: number, title: string) => {
		try {
			const request: CreateTaskRequest = { title, parent_task_id: parentId };
			const newTask = await Effect.runPromise(createTask(request));
			setTodos([...todos(), newTask]);
		} catch (error) {
			console.error("创建子任务失败:", error);
			alert(`创建子任务失败: ${getErrorMessage(error)}`);
		}
	};

	// 处理Card删除（乐观更新）
	const handleCardDelete = async (id: number) => {
		if (!confirm("确定要删除这个卡片吗？")) return;

		// 乐观更新：先从列表中移除
		setRecentCards(recentCards().filter((card) => card.id !== id));
		setStats((prev) => ({
			...prev,
			totalCards: prev.totalCards - 1,
		}));

		try {
			await Effect.runPromise(apiDeleteCard(id));
		} catch (error) {
			console.error("删除卡片失败:", error);
			alert(`删除卡片失败: ${getErrorMessage(error)}`);
			try {
				const cards = await Effect.runPromise(getCards());
				const sortedCards = [...cards].sort(
					(a, b) =>
						new Date(b.updated_at).getTime() -
						new Date(a.updated_at).getTime(),
				);
				setRecentCards(sortedCards.slice(0, 4));
				setStats((prev) => ({ ...prev, totalCards: cards.length }));
			} catch {
				// 静默失败
			}
		}
	};

	return (
		<div class={styles.homePage}>
			{/* 统计卡片 */}
			<div class={styles.statsGrid}>
				<div class={styles.statCard}>
					<div class={styles.statValue}>{stats().totalTasks}</div>
					<div class={styles.statLabel}>总任务</div>
				</div>
				<div class={styles.statCard}>
					<div class={styles.statValue}>{stats().completedTasks}</div>
					<div class={styles.statLabel}>已完成</div>
				</div>
				<div class={styles.statCard}>
					<div class={styles.statValue}>{stats().pendingTasks}</div>
					<div class={styles.statLabel}>待处理</div>
				</div>
				<div class={styles.statCard}>
					<div class={styles.statValue}>{stats().totalCards}</div>
					<div class={styles.statLabel}>总卡片</div>
				</div>
			</div>

			<div class={styles.mainContent}>
				{/* 左侧任务列表 */}
				<div class={styles.todoSection}>
					<div class={styles.sectionHeader}>
						<h2 class={styles.sectionTitle}>待办事项</h2>
						<div class={styles.sectionActions}>
							<A href="/tasks" class={styles.viewAllLink}>
								查看全部 →
							</A>
						</div>
					</div>

					{/* 添加新任务表单 */}
					<div class={styles.addTodoForm}>
						<input
							type="text"
							placeholder="输入新任务标题..."
							value={newTodoTitle()}
							onInput={(e) => setNewTodoTitle(e.currentTarget.value)}
							class={styles.todoInput}
							onKeyPress={(e) => e.key === "Enter" && addTodo()}
						/>
						<textarea
							placeholder="任务描述（可选）..."
							value={newTodoDescription()}
							onInput={(e) => setNewTodoDescription(e.currentTarget.value)}
							class={styles.todoTextarea}
						/>
						<div class={styles.formActions}>
							<button
								type="button"
								onClick={addTodo}
								class={styles.addButton}
								disabled={!newTodoTitle().trim()}
							>
								添加任务
							</button>
						</div>
					</div>

					{/* 使用统一的 TaskList 组件 */}
					<Show
						when={todos().length > 0}
						fallback={
							<div class={styles.emptyState}>
								<Show when={!loading()}>
									<p>暂无待办事项</p>
									<p class={styles.emptyHint}>添加您的第一个任务吧！</p>
								</Show>
								<Show when={loading()}>
									<p>加载中...</p>
								</Show>
							</div>
						}
					>
						<TaskList
							tasks={todos()}
							onStatusChange={handleStatusChange}
							onDelete={handleDelete}
							onUpdate={handleUpdateTask}
							onAddSubTask={handleAddSubTask}
						/>
					</Show>
				</div>

				{/* 右侧最近创建的card */}
				<div class={styles.cardsSection}>
					<div class={styles.sectionHeader}>
						<h2 class={styles.sectionTitle}>最近创建的卡片</h2>
						<div class={styles.sectionActions}>
							<A href="/c" class={styles.viewAllLink}>
								查看全部 →
							</A>
							<A href="/c" class={styles.createLink}>
								+ 新建卡片
							</A>
						</div>
					</div>

					<div class={styles.cardsGrid}>
						<Show
							when={recentCards().length > 0}
							fallback={
								<div class={styles.emptyState}>
									<Show when={!loading()}>
										<p>暂无知识卡片</p>
										<p class={styles.emptyHint}>创建您的第一个知识卡片吧！</p>
									</Show>
									<Show when={loading()}>
										<p>加载中...</p>
									</Show>
								</div>
							}
						>
							<For each={recentCards()}>
								{(card) => (
									<div class={styles.cardWrapper}>
										<Card
											id={card.id}
											content={card.content}
											created_at={card.created_at}
											updated_at={card.updated_at}
											maxContentLines={2}
											onEdit={(id) => navigate(`/c/edit/${id}`)}
											onDelete={handleCardDelete}
										/>
									</div>
								)}
							</For>
						</Show>
					</div>
				</div>
			</div>
		</div>
	);
};

export default HomePage;