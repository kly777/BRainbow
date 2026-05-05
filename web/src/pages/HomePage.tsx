import { A, useNavigate } from "@solidjs/router";
import { Effect } from "effect";
import { createSignal, onMount, Show } from "solid-js";
import { deleteCard as apiDeleteCard, getCards } from "@/apis/cardApi";
import { createTask, getTasks } from "@/apis/taskApi";
import {
	type CreateTaskRequest,
	getErrorMessage,
	type Task,
} from "@/apis/types";
import type { CardData } from "@/components/Card";
import CardsGrid from "@/components/CardsGrid";
import TaskList from "@/components/TaskList";
import { useTaskActions } from "@/hooks/useTaskActions";
import styles from "./HomePage.module.css";

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

	// 加载所有数据
	const loadData = async () => {
		try {
			setLoading(true);

			// 并行加载任务和卡片
			const [allTasks, cards] = await Promise.all([
				Effect.runPromise(getTasks()),
				Effect.runPromise(getCards()),
			]);

			setTodos([...allTasks.items]);

			// 按 updated_at 降序排列，取前4个
			const sortedCards = [...cards.items].sort(
				(a, b) =>
					new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
			);
			setRecentCards(sortedCards.slice(0, 4));
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
			// 如果失败，从列表中移除临时任务
			setTodos(todos().filter((t) => t.id !== tempId));
			alert(`创建任务失败: ${msg}`);
		}
	};

	const {
		handleStatusChange,
		handleDelete,
		handleUpdateTask,
		handleAddSubTask,
	} = useTaskActions(todos, setTodos, loadData);

	// 处理Card删除（乐观更新）
	const handleCardDelete = async (id: number) => {
		if (!confirm("确定要删除这个卡片吗？")) return;

		// 乐观更新：先从列表中移除
		setRecentCards(recentCards().filter((card) => card.id !== id));

		try {
			await Effect.runPromise(apiDeleteCard(id));
		} catch (error) {
			console.error("删除卡片失败:", error);
			alert(`删除卡片失败: ${getErrorMessage(error)}`);
			try {
				const cards = await Effect.runPromise(getCards());
				const sortedCards = [...cards.items].sort(
					(a, b) =>
						new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
				);
				setRecentCards(sortedCards.slice(0, 4));
			} catch {
				// 静默失败
			}
		}
	};

	return (
		<div class={styles.homePage}>
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
						<CardsGrid
							cards={recentCards()}
							showFilters={false}
							onCardEdit={(id) => navigate(`/c/edit/${id}`)}
							onCardDelete={handleCardDelete}
							emptyMessage="暂无知识卡片"
						/>
					</Show>
				</div>
			</div>
		</div>
	);
};

export default HomePage;
