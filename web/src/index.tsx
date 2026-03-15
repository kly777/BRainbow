import { Route, Router } from "@solidjs/router";
import { type JSX, lazy } from "solid-js";
import { render } from "solid-js/web";
import "./style.css";
import styles from "./styles/layout.module.css";

// 懒加载页面组件
const TaskListPage = lazy(async () => import("./pages/TaskList"));
const TaskDetailPage = lazy(async () => import("./pages/TaskDetail"));
const TaskFormPage = lazy(async () => import("./pages/TaskForm"));

// 布局组件
function Layout(props: { children: JSX.Element }) {
	return (
		<div class={styles.appContainer}>
			<header class={styles.appHeader}>
				<div class={styles.headerContent}>
					<h1 class={styles.appTitle}>
						Brainbow <span>任务管理</span>
					</h1>
					<nav class={styles.navLinks}>
						<a href="/" class={styles.navLink}>
							任务列表
						</a>
						<a href="/create" class={styles.navLink}>
							创建任务
						</a>
					</nav>
				</div>
			</header>
			<main class={styles.appContent}>{props.children}</main>
			<footer class={styles.footer}>
				<p>© {new Date().getFullYear()} Brainbow 任务管理系统</p>
			</footer>
		</div>
	);
}

// 根组件
function App() {
	return (
		<Router>
			<Route
				path="/"
				component={() => (
					<Layout>
						<TaskListPage />
					</Layout>
				)}
			/>
			<Route
				path="/task/:id"
				component={() => (
					<Layout>
						<TaskDetailPage />
					</Layout>
				)}
			/>
			<Route
				path="/create"
				component={() => (
					<Layout>
						<TaskFormPage />
					</Layout>
				)}
			/>
			<Route
				path="/edit/:id"
				component={() => (
					<Layout>
						<TaskFormPage editMode />
					</Layout>
				)}
			/>
		</Router>
	);
}

// 渲染应用
const root = document.getElementById("app");
if (!root) {
	// 如果不存在root元素，创建一个
	const appDiv = document.createElement("div");
	appDiv.id = "app";
	document.body.appendChild(appDiv);
	render(() => <App />, appDiv);
} else {
	render(() => <App />, root);
}
