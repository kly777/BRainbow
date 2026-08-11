import { AuthProvider } from "@auth/context.tsx";
import { generateIcon } from "@shared/lib/icon.ts";
import { Router } from "@solidjs/router";
import { initTheme } from "@styles/theme.ts";
import { onMount } from "solid-js";
import { render } from "solid-js/web";
import Layout from "./Layout.tsx";
import { ROUTES, toRouteDefs } from "./routes.ts";
import "@/global.css";
import "@/styles/tokens.css";

// 应用持久化主题（在渲染前挂主题类，避免闪烁）
initTheme();

function App() {
	onMount(() => generateIcon());
	return (
		<AuthProvider>
			<Router root={Layout}>{toRouteDefs(ROUTES)}</Router>
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
