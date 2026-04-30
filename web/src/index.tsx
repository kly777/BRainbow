import { A, Route, Router } from "@solidjs/router";
import { type JSX, lazy } from "solid-js";
import { render } from "solid-js/web";
import "@/normalize.css";
import "@/markdown.css";
import styles from "./App.module.css"

// 懒加载页面组件
const HomePage = lazy(async () => import("@/pages/HomePage"));
const TaskManagerPage = lazy(async () => import("@/pages/TaskManager"));

const CardsListPage = lazy(async () => import("@/pages/notes/CardsList"));
const CardDetailPage = lazy(async () => import("@/pages/notes/CardDetail"));
const CardEditPage = lazy(async () => import("@/pages/notes/CardEdit"));

const OntologyListPage = lazy(
	async () => import("@/pages/ontology/OntologyList"),
);

const Layout = (props: { children?: JSX.Element }) => {
	return (
		<div class={styles.appContainer}>
			<header class={styles.appHeader}>
				<div class={styles.headerContent}>
					<h1 class={styles.appTitle}>
						Brain<span>bow</span>
					</h1>
					<nav class={styles.navLinks}>
						<A href="/" class={styles.navLink} activeClass={styles.active} end>
							主页
						</A>
						<A href="/tasks" class={styles.navLink} activeClass={styles.active} end>
							时间管理
						</A>
						<A href="/c" class={styles.navLink} activeClass={styles.active} end>
							卡片
						</A>
						<A href="/o" class={styles.navLink} activeClass={styles.active} end>
							本体
						</A>
					</nav>
				</div>
			</header>
			<main class={styles.appContent}>{props.children}</main>
		</div>
	);
};

function App() {
	return (
		<Router root={Layout}>
			<Route path="/" component={() => <HomePage />} />
			<Route path="/tasks" component={() => <TaskManagerPage />} />
			<Route path="/o" component={() => <OntologyListPage />} />
			<Route path="/c" component={() => <CardsListPage />} />
			<Route path="/c/:id" component={() => <CardDetailPage />} />
			<Route path="/c/edit/:id" component={() => <CardEditPage />} />
		</Router>
	);
}

const root = document.getElementById("app");
if (!root) {
	const appDiv = document.createElement("div");
	appDiv.id = "app";
	document.body.appendChild(appDiv);
	render(() => <App />, appDiv);
} else {
	render(() => <App />, root);
}
