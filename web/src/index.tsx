import { A, Route, Router } from "@solidjs/router";
import { type JSX, lazy } from "solid-js";
import { render } from "solid-js/web";
import "@/style.css";
import styles from "@/styles/layout.module.css";

// 懒加载页面组件
const TaskListPage = lazy(async () => import("@/pages/tasks/TaskList"));
const TaskDetailPage = lazy(async () => import("@/pages/tasks/TaskDetail"));
const TaskFormPage = lazy(async () => import("@/pages/tasks/TaskForm"));
const NotesListPage = lazy(async () => import("@/pages/notes/NotesList"));
const OntologyListPage = lazy(async () => import("@/pages/ontology/OntologyList"));

// 布局组件
function Layout(props: { children: JSX.Element }) {
	return (
		<div class={styles.appContainer}>
			<header class={styles.appHeader}>
				<div class={styles.headerContent}>
					<h1 class={styles.appTitle}>
						Brainbow <span>信息管理</span>
					</h1>
					<nav class={styles.navLinks}>
						<A href="/t" class={styles.navLink} activeClass={styles.active}>
							结构管理
						</A>
						<A href="/t/create" class={styles.navLink} activeClass={styles.active}>
							新建项目
						</A>
						<A href="/n" class={styles.navLink} activeClass={styles.active}>
							笔记
						</A>
						<A href="/o" class={styles.navLink} activeClass={styles.active}>
							知识管理
						</A>
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
						<div class={styles.landingPage}>
							<h1>欢迎使用 Brainbow</h1>
							<p>一个综合的信息管理系统，帮助您组织和管理各种类型的信息</p>
							<div class={styles.featureGrid}>
								<div class={styles.featureCard}>
									<h3>📋 结构化管理</h3>
									<p>有序组织您的信息和任务，建立清晰的层次结构</p>
									<A href="/t" class={styles.featureLink}>探索功能 →</A>
								</div>
								<div class={styles.featureCard}>
									<h3>📝 灵活记录</h3>
									<p>随时记录想法和灵感，支持多种格式和分类方式</p>
									<A href="/n" class={styles.featureLink}>开始记录 →</A>
								</div>
								<div class={styles.featureCard}>
									<h3>🧠 知识构建</h3>
									<p>建立知识网络，连接概念和想法，形成系统认知</p>
									<A href="/o" class={styles.featureLink}>开始构建 →</A>
								</div>
							</div>
							<div class={styles.quickStats}>
								<p>🚀 开箱即用，无需复杂配置</p>
								<p>📱 全平台适配，随时随地访问</p>
								<p>🎨 简洁设计，专注内容本身</p>
							</div>
						</div>
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
				path="/n"
				component={() => (
					<Layout>
						<NotesListPage />
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
