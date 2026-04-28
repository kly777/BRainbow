import { A } from "@solidjs/router";
import {
	type Component,
	createEffect,
	createSignal,
	For,
	Show,
} from "solid-js";
import Card, { type CardData } from "@/components/Card";
import styles from "@/styles/pages/home.module.css";

// Todo项接口
interface TodoItem {
	id: number;
	title: string;
	description?: string;
	completed: boolean;
	priority: "low" | "medium" | "high";
	dueDate?: string;
	createdAt: string;
}

// 主页组件
const HomePage: Component = () => {
	// Todo列表状态
	const [todos, setTodos] = createSignal<TodoItem[]>([
		{
			id: 1,
			title: "完成项目文档",
			description: "编写项目README和API文档",
			completed: false,
			priority: "high",
			dueDate: "2024-12-31",
			createdAt: "2024-12-01T10:00:00Z",
		},
		{
			id: 2,
			title: "修复登录页面bug",
			description: "修复移动端登录页面布局问题",
			completed: true,
			priority: "medium",
			dueDate: "2024-12-15",
			createdAt: "2024-12-02T14:30:00Z",
		},
		{
			id: 3,
			title: "设计新功能原型",
			description: "设计数据可视化功能原型",
			completed: false,
			priority: "high",
			dueDate: "2024-12-20",
			createdAt: "2024-12-03T09:15:00Z",
		},
		{
			id: 4,
			title: "团队周会",
			description: "每周团队进度同步会议",
			completed: false,
			priority: "low",
			dueDate: "2024-12-08",
			createdAt: "2024-12-04T16:45:00Z",
		},
		{
			id: 5,
			title: "代码审查",
			description: "审查新提交的PR",
			completed: false,
			priority: "medium",
			dueDate: "2024-12-10",
			createdAt: "2024-12-05T11:20:00Z",
		},
	]);

	// 最近创建的card状态
	const [recentCards, setRecentCards] = createSignal<CardData[]>([
		{
			id: 1,
			title: "项目架构设计",
			content:
				"## 系统架构\n\n采用微服务架构，前端使用SolidJS，后端使用Rust。\n\n### 主要组件\n- API网关\n- 用户服务\n- 数据服务\n- 文件服务",
			created_at: "2024-12-05T14:30:00Z",
			updated_at: "2024-12-05T14:30:00Z",
		},
		{
			id: 2,
			title: "API接口文档",
			content:
				"## REST API\n\n### 用户相关\n- GET /api/users\n- POST /api/users\n- PUT /api/users/:id\n\n### 卡片相关\n- GET /api/cards\n- POST /api/cards\n- PUT /api/cards/:id",
			created_at: "2024-12-04T10:15:00Z",
			updated_at: "2024-12-04T10:15:00Z",
		},
		{
			id: 3,
			title: "开发计划",
			content:
				"## Q4开发计划\n\n1. 完成核心功能开发\n2. 实现用户认证系统\n3. 添加数据导出功能\n4. 优化移动端体验",
			created_at: "2024-12-03T09:00:00Z",
			updated_at: "2024-12-03T09:00:00Z",
		},
		{
			id: 4,
			title: "技术栈选择",
			content:
				"## 前端技术栈\n- SolidJS\n- TypeScript\n- Vite\n- Tailwind CSS\n\n## 后端技术栈\n- Rust\n- Actix-web\n- PostgreSQL\n- Redis",
			created_at: "2024-12-02T16:45:00Z",
			updated_at: "2024-12-02T16:45:00Z",
		},
	]);

	// 新Todo输入状态
	const [newTodoTitle, setNewTodoTitle] = createSignal("");
	const [newTodoDescription, setNewTodoDescription] = createSignal("");
	const [newTodoPriority, setNewTodoPriority] = createSignal<
		"low" | "medium" | "high"
	>("medium");

	// 统计信息
	const [_stats, setStats] = createSignal({
		totalTodos: 0,
		completedTodos: 0,
		pendingTodos: 0,
		highPriorityTodos: 0,
		totalCards: 0,
	});

	// 更新统计信息
	createEffect(() => {
		const todoList = todos();
		const completed = todoList.filter((todo) => todo.completed).length;
		const pending = todoList.filter((todo) => !todo.completed).length;
		const highPriority = todoList.filter(
			(todo) => todo.priority === "high",
		).length;

		setStats({
			totalTodos: todoList.length,
			completedTodos: completed,
			pendingTodos: pending,
			highPriorityTodos: highPriority,
			totalCards: recentCards().length,
		});
	});

	// 添加新Todo
	const addTodo = () => {
		if (!newTodoTitle().trim()) return;

		const newTodo: TodoItem = {
			id: Date.now(),
			title: newTodoTitle(),
			description: newTodoDescription(),
			completed: false,
			priority: newTodoPriority(),
			createdAt: new Date().toISOString(),
		};

		setTodos([newTodo, ...todos()]);
		setNewTodoTitle("");
		setNewTodoDescription("");
		setNewTodoPriority("medium");
	};

	// 切换Todo完成状态
	const toggleTodo = (id: number) => {
		setTodos(
			todos().map((todo) =>
				todo.id === id ? { ...todo, completed: !todo.completed } : todo,
			),
		);
	};

	// 删除Todo
	const deleteTodo = (id: number) => {
		setTodos(todos().filter((todo) => todo.id !== id));
	};

	// 获取优先级颜色
	const getPriorityColor = (priority: "low" | "medium" | "high") => {
		switch (priority) {
			case "high":
				return styles.priorityHigh;
			case "medium":
				return styles.priorityMedium;
			case "low":
				return styles.priorityLow;
			default:
				return "";
		}
	};

	// 获取优先级文本
	const getPriorityText = (priority: "low" | "medium" | "high") => {
		switch (priority) {
			case "high":
				return "高";
			case "medium":
				return "中";
			case "low":
				return "低";
			default:
				return "";
		}
	};

	// 格式化日期
	const formatDate = (dateString?: string) => {
		if (!dateString) return "无截止日期";

		try {
			const date = new Date(dateString);
			return date.toLocaleDateString("zh-CN", {
				month: "2-digit",
				day: "2-digit",
			});
		} catch {
			return dateString;
		}
	};

	// 处理Card编辑
	const handleCardEdit = (id: number) => {
		console.log("编辑卡片:", id);
		// 这里可以跳转到编辑页面
		window.location.href = `/c/edit/${id}`;
	};

	// 处理Card删除
	const handleCardDelete = (id: number) => {
		if (confirm("确定要删除这个卡片吗？")) {
			setRecentCards(recentCards().filter((card) => card.id !== id));
		}
	};

	return (
		<div class={styles.homePage}>
			<div class={styles.mainContent}>
				{/* 左侧Todo列表 */}
				<div class={styles.todoSection}>
					<div class={styles.sectionHeader}>
						<h2 class={styles.sectionTitle}>待办事项</h2>
						<div class={styles.sectionActions}>
							<A href="/c" class={styles.viewAllLink}>
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
							<div class={styles.prioritySelector}>
								<label for="priority-select">优先级：</label>
								<select
									id="priority-select"
									value={newTodoPriority()}
									onChange={(e) =>
										setNewTodoPriority(
											e.currentTarget.value as "low" | "medium" | "high",
										)
									}
									class={styles.prioritySelect}
								>
									<option value="low">低</option>
									<option value="medium">中</option>
									<option value="high">高</option>
								</select>
							</div>
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
									<p>暂无待办事项</p>
									<p class={styles.emptyHint}>添加您的第一个任务吧！</p>
								</div>
							}
						>
							<For each={todos()}>
								{(todo) => (
									<div
										class={`${styles.todoItem} ${todo.completed ? styles.completed : ""}`}
									>
										<div class={styles.todoCheckbox}>
											<label
												class={styles.checkboxLabel}
												for={`todo-checkbox-${todo.id}`}
											>
												<input
													type="checkbox"
													id={`todo-checkbox-${todo.id}`}
													checked={todo.completed}
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
													class={`${styles.priorityBadge} ${getPriorityColor(todo.priority)}`}
												>
													{getPriorityText(todo.priority)}
												</span>
											</div>
											<Show when={todo.description}>
												<p class={styles.todoDescription}>{todo.description}</p>
											</Show>
											<div class={styles.todoMeta}>
												<Show when={todo.dueDate}>
													<span class={styles.dueDate}>
														截止: {formatDate(todo.dueDate)}
													</span>
												</Show>
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
							<A href="/c" class={styles.viewAllLink}>
								查看全部 →
							</A>
							<A href="/c/edit/new" class={styles.createLink}>
								+ 新建卡片
							</A>
						</div>
					</div>

					<div class={styles.cardsGrid}>
						<Show
							when={recentCards().length > 0}
							fallback={
								<div class={styles.emptyState}>
									<p>暂无知识卡片</p>
									<p class={styles.emptyHint}>创建您的第一个知识卡片吧！</p>
								</div>
							}
						>
							<For each={recentCards()}>
								{(card) => (
									<div class={styles.cardWrapper}>
										<Card
											{...card}
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
