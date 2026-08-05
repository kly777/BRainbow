import { useLocation } from "@solidjs/router";
import { type JSX, Show } from "solid-js";
import * as styles from "./App.css.ts";
import AuthGuard from "@auth/AuthGuard.tsx";
import AuthStatus from "@auth/AuthStatus.tsx";
import CommandPalette from "@components/CommandPalette.tsx";
import ConfirmModalContainer from "@components/ui/ConfirmModal.tsx";
import ToastContainer from "@components/ui/Toast.tsx";
import { RouteTitle } from "./routes.ts";

export default function Layout(props: { children?: JSX.Element }) {
	const location = useLocation();
	// 首页公开（HomeGuard 自行切换着陆页/仪表盘），其余路由均需认证
	const isPublic = () => location.pathname === "/";

	return (
		<div class={styles.shell}>
			<RouteTitle />
			<main class={styles.content}>
				<Show
					when={isPublic()}
					fallback={<AuthGuard>{props.children}</AuthGuard>}
				>
					{props.children}
				</Show>
			</main>
			<AuthStatus />
			<CommandPalette />
			<ToastContainer />
			<ConfirmModalContainer />
		</div>
	);
}
