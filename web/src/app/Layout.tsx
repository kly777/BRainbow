import AuthGuard from "@app/auth/AuthGuard.tsx";
import AuthStatus from "@app/auth/AuthStatus.tsx";
import AiSettingsModal from "@app/ui/AiSettingsModal.tsx";
import CommandPalette from "@app/ui/CommandPalette";
import ConfirmModalContainer from "@app/ui/ConfirmModal";
import ToastContainer from "@app/ui/Toast";
import { useLocation } from "@solidjs/router";
import { type JSX, Show } from "solid-js";
import styles from "./App.module.css";
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
			<AiSettingsModal />
		</div>
	);
}
