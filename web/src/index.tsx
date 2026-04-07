import { Route, Router } from "@solidjs/router";
import { type JSX, lazy } from "solid-js";
import { render } from "solid-js/web";
import "@/normalize.css";
import "@/styles/markdown.css";
import styles from "@/styles/layout.module.css";

// 懒加载页面组件

const CardsListPage = lazy(async () => import("@/pages/notes/CardsList"));
const CardDetailPage = lazy(async () => import("@/pages/notes/CardDetail"));
const CardEditPage = lazy(async () => import("@/pages/notes/CardEdit"));

const OntologyListPage = lazy(
	async () => import("@/pages/ontology/OntologyList"),
);

const Layout = (props: { children?: JSX.Element }) => {
	return (
		<div class={styles.appContainer}>
			<main class={styles.appContent}>{props.children}</main>
			<footer class={styles.footer}>
				<p>© {new Date().getFullYear()} Brainbow 任务管理系统</p>
			</footer>
		</div>
	);
};

function App() {
	return (
		<Router root={Layout}>
			<Route
				path="/"
				component={() => <div class={styles.landingPage}></div>}
			/>
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
