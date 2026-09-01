import { AuthProvider } from "@app/context/auth.tsx";
import { initFontScale, initTheme } from "@shared/styles";
import { generateIcon } from "@shared/utils";
import { Router } from "@solidjs/router";
import { onMount } from "solid-js";
import { render } from "solid-js/web";
import Layout from "./Layout.tsx";
import { ROUTES, toRouteDefs } from "./routes.ts";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/noto-serif-sc";
import "@app/global.css";
import "@shared/styles/tokens.css";

// 应用持久化主题与字号档位（在渲染前挂主题/根字号，避免闪烁）
initTheme();
initFontScale();

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
