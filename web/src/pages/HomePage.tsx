import { A } from "@solidjs/router";
import { Effect } from "effect";
import { createSignal, For, onMount, Show } from "solid-js";
import Card, { type CardData } from "@/components/Card";
import {
	getBacklogTasks,
	createTask,
	completeTask,
	moveToBacklog,
	deleteTask,
	getTasks,
} from "@/apis/taskApi";
import { getCards, deleteCard as apiDeleteCard } from "@/apis/cardApi";
import type { CreateTaskRequest, Task } from "@/apis/types";
import { formatDate, getStatusText } from "@/apis/types";
import styles from "@/styles/pages/home.module.css";

// 主页组件
const HomePage = () => {
	// Todo列表状态（来自后端backlog任务）
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

			// 并行加载任务和卡片
			const [backlogTasks, allTasks, cards] = await Promise.all([
				Effect.runPromise(getBacklogTasks()),
				Effect.runPromise(getTasks()),
				Effect.runPromise(getCards()),
			]);

			setTodos([...backlogTasks]);

			// 按 updated_at 降序排列，取前4个
			const sortedCards = [...cards].sort(
				(a, b) =>
					new Date(b.updated_at).getTime() -
					new Date(a.updated_at).getTime(),
			);
			setRecentCards(sortedCards.slice(0, 4));

			// 计算统计信息
			const taskList = [...allTasks];
			const completed = taskList.filter(
				(t) => t.status === "completed",
			).length;
			const pending = taskList.filter(
				(t) => t.status !== "completed",
			).length;

			setStats({
				totalTasks: taskList.length,
				completedTasks: completed,
				pendingTasks: pending,
				totalCards: cards.length,
			});
		} catch (error) {
			console.error("加载数据失败:", error);
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
			console.error("创建任务失败:", error);
			// 如果失败，从列表中移除临时任务并恢复统计
			setTodos(todos().filter((t) => t.id !== tempId));
			setStats((prev) => ({
				...prev,
				totalTasks: prev.totalTasks - 1,
				pendingTasks: prev.pendingTasks - 1,
			}));
			alert("创建任务失败，请重试");
		}
	};

	// 切换Todo完成状态（乐观更新）
	const toggleTodo = async (id: number) => {
		const task = todos().find((t) => t.id === id);
		if (!task) return;

		const isCompleted = task.status === "completed";
		const newStatus = isCompleted ? "backlog" : "completed";

		// 保存原始状态用于回滚
		const originalStatus = task.status;

		// 乐观更新：先在本地切换状态
		setTodos(
			todos().map((t) => (t.id === id ? { ...t, status: newStatus } : t)),
		);

		// 更新本地统计
		setStats((prev) => ({
			...prev,
			completedTasks: isCompleted
				? prev.completedTasks - 1
				: prev.completedTasks + 1,
			pendingTasks: isCompleted
				? prev.pendingTasks + 1
				: prev.pendingTasks - 1,
		}));

		try {
			// 根据状态调用不同的 API
			if (isCompleted) {
				await Effect.runPromise(moveToBacklog(id));
			} else {
				await Effect.runPromise(completeTask(id));
			}
		} catch (error) {
			console.error("更新任务状态失败:", error);
			// 如果失败，回滚到原来的状态
			setTodos(
				todos().map((t) =>
					t.id === id ? { ...t, status: originalStatus } : t,
				),
			);
			setStats((prev) => ({
				...prev,
				completedTasks: isCompleted
					? prev.completedTasks + 1
					: prev.completedTasks - 1,
				pendingTasks: isCompleted
					? prev.pendingTasks - 1
					: prev.pendingTasks + 1,
			}));
			alert("更新任务状态失败，请重试");
		}
	};

	// 删除Todo（乐观更新）
	const deleteTodo = async (id: number) => {
		const task = todos().find((t) => t.id === id);
		const wasCompleted = task?.status === "completed";

		// 乐观更新：先从列表中移除
		setTodos(todos().filter((t) => t.id !== id));
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
			await Effect.runPromise(deleteTask(id));
		} catch (error) {
			console.error("删除任务失败:", error);
			// 如果删除失败，重新加载任务列表
			loadData();
		}
	};

	// 获取状态徽章样式
	const getStatusBadgeClass = (status: string | null) => {
		switch (status) {
			case "completed":
				return styles.priorityLow;
			case "active":
				return styles.priorityHigh;
			case "backlog":
			default:
				return styles.priorityMedium;
		}
	};

	// 处理Card编辑
	const handleCardEdit = (id: number) => {
		window.location.href = `/c/edit/${id}`;
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
			// 如果删除失败，重新加载卡片列表
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
				// 如果重新加载也失败，保持当前状态
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
				{/* 左侧Todo列表 */}
				<div class={styles.todoSection}>
					<div class={styles.sectionHeader}>
						<h2 class={styles.sectionTitle}>待办事项</h2>
						<div class={styles.sectionActions}>
							<A href="/tasks" class={styles.viewAllLink}>
								查看全部 →
							</A>
						</div>
					</div>

					{/* 添加新Todo表单 */}
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

					{/* Todo列表 */}
					<div class={styles.todoList}>
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
							<For each={todos()}>
								{(todo) => (
									<div
										class={`${styles.todoItem} ${todo.status === "completed" ? styles.completed : ""}`}
									>
										<div class={styles.todoCheckbox}>
											<label
												class={styles.checkboxLabel}
												for={`todo-checkbox-${todo.id}`}
											>
												<input
													type="checkbox"
													id={`todo-checkbox-${todo.id}`}
													checked={todo.status === "completed"}
													onChange={() => toggleTodo(todo.id)}
													class={styles.checkbox}
												/>
												<span class={styles.checkboxCustom}></span>
											</label>
										</div>
										<div class={styles.todoContent}>
											<div class={styles.todoHeader}>
												<h3 class={styles.todoTitle}>{todo.title}</h3>
												<span
													class={`${styles.priorityBadge} ${getStatusBadgeClass(todo.status)}`}
												>
													{getStatusText(todo.status ?? "backlog")}
												</span>
											</div>
											<Show when={todo.description}>
												<p class={styles.todoDescription}>{todo.description}</p>
											</Show>
											<div class={styles.todoMeta}>
												<span class={styles.dueDate}>
													创建: {formatDate(todo.created_at)}
												</span>
												<button
													type="button"
													onClick={() => deleteTodo(todo.id)}
													class={styles.deleteTodoButton}
												>
													删除
												</button>
											</div>
										</div>
									</div>
								)}
							</For>
						</Show>
					</div>
				</div>

				{/* 右侧最近创建的card */}
				<div class={styles.cardsSection}>
					<div class={styles.sectionHeader}>
						<h2 class={styles.sectionTitle}>最近创建的卡片</h2>
						<div class={styles.sectionActions}>
							<A href="/cards" class={styles.viewAllLink}>
								查看全部 →
							</A>
							<A href="/cards" class={styles.createLink}>
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
											title={card.title}
											content={card.content}
											created_at={card.created_at}
											updated_at={card.updated_at}
											maxContentLines={2}
											onEdit={handleCardEdit}
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