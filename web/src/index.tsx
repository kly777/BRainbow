import { Route, Router } from "@solidjs/router";
import { lazy } from "solid-js";
import { render } from "solid-js/web";
import { AuthProvider } from "./auth";
import Layout from "./Layout";
import "@/normalize.css";

const HomePage = lazy(() => import("@/pages/HomePage"));
const TaskManagerPage = lazy(() => import("@/pages/TaskManager"));
const OntologyListPage = lazy(() => import("@/pages/ontology/OntologyList"));
const CardsListPage = lazy(() => import("@/pages/notes/CardsList"));
const CardDetailPage = lazy(() => import("@/pages/notes/CardDetail"));
const CardEditPage = lazy(() => import("@/pages/notes/CardEdit"));
const DbViewerPage = lazy(() => import("@/pages/DbViewer"));

function App() {
	return (
		<AuthProvider>
			<Router root={Layout}>
				<Route path="/" component={() => <HomePage />} />
				<Route path="/tasks" component={() => <TaskManagerPage />} />
				<Route path="/o" component={() => <OntologyListPage />} />
				<Route path="/c" component={() => <CardsListPage />} />
				<Route path="/c/:id" component={() => <CardDetailPage />} />
				<Route path="/c/edit/:id" component={() => <CardEditPage />} />
				<Route path="/db" component={() => <DbViewerPage />} />
			</Router>
		</AuthProvider>
	);
}

const root = document.getElementById("app");
if (!root) {
	const el = document.createElement("div");
	el.id = "app";
	document.body.appendChild(el);
	render(() => <App />, el);
} else {
	render(() => <App />, root);
}
