import { Route, Router } from "@solidjs/router";
import { type JSX, lazy } from "solid-js";
import { render } from "solid-js/web";
import "@/normalize.css";
import styles from "@/styles/layout.module.css";

// 懒加载页面组件
const TaskListPage = lazy(async () => import("@/pages/tasks/TaskList"));
const TaskDetailPage = lazy(async () => import("@/pages/tasks/TaskDetail"));
const TaskFormPage = lazy(async () => import("@/pages/tasks/TaskForm"));

const CardsListPage = lazy(async () => import("@/pages/notes/CardsList"));
const CardDetailPage = lazy(async () => import("@/pages/notes/CardDetail"));

const OntologyListPage = lazy(
	async () => import("@/pages/ontology/OntologyList"),
);

// 布局组件
function Layout(props: { children: JSX.Element }) {
	return (
		<div class={styles.appContainer}>
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
						<div class={styles.landingPage}></div>
					</Layout>
				)}
			/>
			<Route
				path="/t"
				component={() => (
					<Layout>
						<TaskListPage />
					</Layout>
				)}
			/>
			<Route
				path="/t/:id"
				component={() => (
					<Layout>
						<TaskDetailPage />
					</Layout>
				)}
			/>
			<Route
				path="/t/create"
				component={() => (
					<Layout>
						<TaskFormPage />
					</Layout>
				)}
			/>
			<Route
				path="/t/edit/:id"
				component={() => (
					<Layout>
						<TaskFormPage editMode />
					</Layout>
				)}
			/>
			<Route
				path="/o"
				component={() => (
					<Layout>
						<OntologyListPage />
					</Layout>
				)}
			/>
			<Route
				path="/c"
				component={() => (
					<Layout>
						<CardsListPage />
					</Layout>
				)}
			/>
			<Route
				path="/c/:id"
				component={() => (
					<Layout>
						<CardDetailPage />
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
