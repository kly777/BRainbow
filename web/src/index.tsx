import { Router } from "@solidjs/router";
import { onMount } from "solid-js";
import { render } from "solid-js/web";
import { AuthProvider } from "./auth/context.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import Layout from "./Layout.tsx";
import { generateIcon } from "./lib/icon.ts";
import { ROUTES, toRouteDefs } from "./routes.ts";
import "@/global.css";

function App() {
	onMount(() => generateIcon());
	return (
		<ErrorBoundary>
			<AuthProvider>
				<Router root={Layout}>{toRouteDefs(ROUTES)}</Router>
			</AuthProvider>
		</ErrorBoundary>
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
